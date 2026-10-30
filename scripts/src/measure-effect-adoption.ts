import { Processes, ProcessError, runNodeMain } from '@fantasy-draft/shared/node';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import {
  ADOPTION_PATTERNS, PLUMBING_PATTERNS, combineMetrics, measureSource,
  type AdoptionMetric, type PlumbingMetric, type SourceMetrics,
} from './effect-adoption-metrics.js';
import { REPO_ROOT } from './model/duckdb.js';

const WORKSPACES = ['cli', 'server', 'scripts', 'extension', 'shared', 'web-app'] as const;
const SELF_COUNTING_FILES = new Set(['effect-adoption-metrics.ts', 'measure-effect-adoption.ts']);
const run = (command: string, args: readonly string[], options: { cwd: string; signal?: AbortSignal }) =>
  Processes.run(command, args, { ...options, timeoutMs: 60_000 });

const listSources = (directory: string): Effect.Effect<string[]> => Effect.promise(async () => {
  // A workspace without a src directory has nothing to count; any other read failure must not look like zero.
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  return entries
    .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !SELF_COUNTING_FILES.has(entry.name))
    .map(entry => join(entry.parentPath, entry.name));
});

const measureWorkspaces = Effect.fn('measureWorkspaces')(function* (root: string) {
  const results = yield* Effect.forEach(WORKSPACES, workspace => listSources(join(root, workspace, 'src')).pipe(
    Effect.flatMap(files => Effect.forEach(files, file => Effect.promise(() => readFile(file, 'utf8'))
      .pipe(Effect.map(source => measureSource(source, file))), { concurrency: 16 })),
    Effect.map(metrics => [workspace, combineMetrics(metrics)] as const),
  ), { concurrency: 'unbounded' });
  return Object.fromEntries(results) as Record<(typeof WORKSPACES)[number], SourceMetrics>;
});

/** Measure another revision in a temporary worktree so local edits never mix into the baseline. */
const measureRevision = (ref: string, signal: AbortSignal) => Effect.acquireUseRelease(
  Effect.promise(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'effect-baseline-'));
    try {
      await run('git', ['worktree', 'add', '--detach', directory, ref], { cwd: REPO_ROOT, signal });
    } catch (error) {
      await run('git', ['worktree', 'remove', '--force', directory], { cwd: REPO_ROOT }).catch(async (cleanupError: unknown) => {
        if (!(cleanupError instanceof ProcessError) || !/is not a working tree/.test(cleanupError.stderr)) throw cleanupError;
        await rm(directory, { recursive: true, force: true });
      });
      throw error;
    }
    return directory;
  }),
  measureWorkspaces,
  // Let git delete the directory so its worktree metadata goes with it.
  directory => Effect.promise(() => run('git', ['worktree', 'remove', '--force', directory], { cwd: REPO_ROOT })
    .then(() => undefined, (error: unknown) => {
      const stderr = error instanceof ProcessError ? error.stderr : '';
      if (!/is not a working tree/.test(stderr)) throw error;
    })),
);

const LABELS: Record<AdoptionMetric | PlumbingMetric, string> = {
  effectFunctions: 'Effect.fn functions', effectGenerators: 'Effect.gen blocks', taggedErrors: 'Tagged error classes',
  streams: 'Stream operations', schedules: 'Schedule operations', declarativeTimeouts: 'Declarative timeouts',
  boundedConcurrency: 'Concurrency options', runners: 'Effect runners',
  tryBlocks: 'try blocks', thrownErrors: 'throw statements', abortSignalPlumbing: 'AbortSignal plumbing',
  manualTimers: 'Manual timers', swallowedErrors: 'Swallowed errors', errnoCasts: 'Errno casts',
  promiseCombinators: 'Promise combinators',
};

function renderTable(title: string, current: Record<string, SourceMetrics>, baseline?: Record<string, SourceMetrics>): string {
  const cell = (workspace: string, read: (metrics: SourceMetrics) => number) => {
    const now = read(current[workspace] as SourceMetrics);
    if (!baseline) return String(now);
    const before = read(baseline[workspace] as SourceMetrics);
    return before === now ? String(now) : `${String(before)} → ${String(now)}`;
  };
  const rows: [string, (metrics: SourceMetrics) => number][] = [
    ['Source files', metrics => metrics.files], ['Files using Effect', metrics => metrics.filesUsingEffect],
    ['Non-blank lines', metrics => metrics.lines],
    ...(Object.keys(ADOPTION_PATTERNS) as AdoptionMetric[]).map(key => [LABELS[key], (metrics: SourceMetrics) => metrics.adoption[key]] as [string, (metrics: SourceMetrics) => number]),
    ...(Object.keys(PLUMBING_PATTERNS) as PlumbingMetric[]).map(key => [LABELS[key], (metrics: SourceMetrics) => metrics.plumbing[key]] as [string, (metrics: SourceMetrics) => number]),
  ];
  return [`### ${title}`, '', `| Metric | ${WORKSPACES.join(' | ')} |`, `| --- |${WORKSPACES.map(() => ' ---: |').join('')}`,
    ...rows.map(([label, read]) => `| ${label} | ${WORKSPACES.map(workspace => cell(workspace, read)).join(' | ')} |`)].join('\n');
}

const program = (signal: AbortSignal) => Effect.gen(function* () {
  const args = process.argv.slice(2);
  const baselineIndex = args.indexOf('--baseline');
  const baselineRef = baselineIndex === -1 ? undefined : args[baselineIndex + 1];
  if (baselineIndex !== -1 && (!baselineRef || baselineRef.startsWith('--'))) {
    return yield* Effect.fail(new Error('--baseline needs a git ref, for example --baseline main'));
  }
  const [current, baseline] = yield* Effect.all([
    measureWorkspaces(REPO_ROOT),
    baselineRef ? measureRevision(baselineRef, signal) : Effect.succeed(undefined),
  ], { concurrency: 'unbounded' });
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ baselineRef: baselineRef ?? null, baseline: baseline ?? null, current }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderTable(baselineRef ? `Effect adoption (${baselineRef} → working tree)` : 'Effect adoption', current, baseline)}\n`);
});

await runNodeMain(async signal => {
  await Effect.runPromise(program(signal), { signal });
});
