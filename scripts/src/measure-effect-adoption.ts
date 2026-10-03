import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import {
  ADOPTION_PATTERNS, PLUMBING_PATTERNS, combineMetrics, measureSource,
  type AdoptionMetric, type PlumbingMetric, type SourceMetrics,
} from './effect-adoption-metrics.js';
import { REPO_ROOT } from './model/duckdb.js';

const WORKSPACES = ['cli', 'server', 'scripts', 'extension', 'shared', 'web-app'] as const;
// These files spell out the patterns they count.
const EXCLUDED_FILES = new Set(['effect-adoption-metrics.ts', 'measure-effect-adoption.ts']);
const run = promisify(execFile);

const listSources = (directory: string): Effect.Effect<string[]> => Effect.promise(async () => {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !EXCLUDED_FILES.has(entry.name))
    .map(entry => join(entry.parentPath, entry.name));
});

const measureWorkspaces = Effect.fn('measureWorkspaces')(function* (root: string) {
  const results = yield* Effect.forEach(WORKSPACES, workspace => listSources(join(root, workspace, 'src')).pipe(
    Effect.flatMap(files => Effect.forEach(files, file => Effect.promise(() => readFile(file, 'utf8')), { concurrency: 16 })),
    Effect.map(sources => [workspace, combineMetrics(sources.map(measureSource))] as const),
  ), { concurrency: 'unbounded' });
  return Object.fromEntries(results) as Record<(typeof WORKSPACES)[number], SourceMetrics>;
});

/** Measure another revision in a temporary worktree so local edits never mix into the baseline. */
const measureRevision = (ref: string) => Effect.acquireUseRelease(
  Effect.promise(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'effect-baseline-'));
    await run('git', ['worktree', 'add', '--detach', directory, ref], { cwd: REPO_ROOT });
    return directory;
  }),
  measureWorkspaces,
  directory => Effect.promise(async () => {
    await run('git', ['worktree', 'remove', '--force', directory], { cwd: REPO_ROOT }).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }),
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

const program = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const baselineIndex = args.indexOf('--baseline');
  const baselineRef = baselineIndex === -1 ? undefined : args[baselineIndex + 1];
  const [current, baseline] = yield* Effect.all([
    measureWorkspaces(REPO_ROOT),
    baselineRef ? measureRevision(baselineRef) : Effect.succeed(undefined),
  ], { concurrency: 'unbounded' });
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ baselineRef: baselineRef ?? null, baseline: baseline ?? null, current }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderTable(baselineRef ? `Effect adoption (${baselineRef} → working tree)` : 'Effect adoption', current, baseline)}\n`);
});

void Effect.runPromise(program).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
