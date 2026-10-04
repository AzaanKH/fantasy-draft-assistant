import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Effect, Fiber } from 'effect';
import {
  DRAFT_DATA_REFRESH_STEPS,
  type DraftDataRefreshStatus,
  type DraftDataRefreshStepState,
} from '@fantasy-draft/shared';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IS_WINDOWS = process.platform === 'win32';
const PNPM_COMMAND = IS_WINDOWS ? 'pnpm.cmd' : 'pnpm';
const STEP_TIMEOUT_MS = 5 * 60_000;
// After SIGTERM a script gets this long to exit before SIGKILL, then this long to be reaped.
const TERM_GRACE_MS = 10_000;
const KILL_GRACE_MS = 5_000;
const MAX_OUTPUT_CHARS = 8_000;
const DETAIL_LINES = 6;
// How often a stopping script's process tree is re-read and signalled again.
const TREE_POLL_MS = 100;

/**
 * Runs one fixed package script. The web client can only choose to start the whole refresh.
 * Interrupting the effect must stop the script.
 */
export type RunRefreshScript = (
  script: string,
  onOutput: (text: string) => void
) => Effect.Effect<void, Error>;

interface StopGrace {
  readonly termGraceMs: number;
  readonly killGraceMs: number;
}

const exited = (child: ChildProcess): Effect.Effect<void> => Effect.callback((resume: (effect: Effect.Effect<void>) => void) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resume(Effect.void);
    return;
  }
  const onExit = () => { resume(Effect.void); };
  child.once('exit', onExit);
  return Effect.sync(() => { child.off('exit', onExit); });
});

/** Each process's parent, from `ps`. Empty if `ps` is unavailable. */
const parentPids = (): Effect.Effect<ReadonlyMap<number, number>> => Effect.callback((resume: (effect: Effect.Effect<ReadonlyMap<number, number>>) => void) => {
  // Zombies are already dead and only wait to be reaped, so they are left out.
  const ps = execFile('ps', ['-A', '-o', 'pid=,ppid=,stat='], (error, stdout) => {
    const parents = new Map<number, number>();
    if (!error) {
      for (const line of stdout.split('\n')) {
        const [pid, ppid, stat] = line.trim().split(/\s+/);
        if (pid && ppid && !stat?.startsWith('Z')) parents.set(Number(pid), Number(ppid));
      }
    }
    resume(Effect.succeed(parents));
  });
  return Effect.sync(() => { ps.kill(); });
});

/**
 * The child and its descendants. A script under pnpm runs in descendants, which stay
 * in the server's process group, so a supervisor that kills the group still stops them.
 * Every process seen is kept, because a descendant whose parent exits is reparented and
 * can no longer be found from the child. Dead processes are dropped so a reused PID is not signalled.
 */
class ProcessTree {
  private readonly pids = new Set<number>();
  // The last signal each process received, so a graceful SIGTERM is not repeated as a forced quit.
  private readonly sent = new Map<number, NodeJS.Signals>();

  constructor(private readonly child: ChildProcess) {
    if (child.pid !== undefined) this.pids.add(child.pid);
  }

  private forget(pid: number): void {
    this.pids.delete(pid);
    this.sent.delete(pid);
  }

  /** Find new descendants, signal each live process once, and report whether any remain. */
  signal(signal: NodeJS.Signals): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const parents = yield* parentPids();
      if (parents.size > 0) {
        for (const pid of this.pids) if (!parents.has(pid) && pid !== this.child.pid) this.forget(pid);
        let added = true;
        while (added) {
          added = false;
          for (const [pid, ppid] of parents) {
            if (this.pids.has(ppid) && !this.pids.has(pid)) { this.pids.add(pid); added = true; }
          }
        }
      }
      for (const pid of this.pids) {
        if (pid === this.child.pid && (this.child.exitCode !== null || this.child.signalCode !== null)) {
          this.forget(pid);
          continue;
        }
        try {
          process.kill(pid, this.sent.get(pid) === signal ? 0 : signal);
          this.sent.set(pid, signal);
        } catch {
          this.forget(pid);
        }
      }
      return this.pids.size > 0;
    });
  }
}

/** Keep signalling the tree until it is empty; a new descendant is signalled as it is found. */
const signalUntilExited = (tree: ProcessTree, signal: NodeJS.Signals): Effect.Effect<void> => Effect.suspend(function loop(): Effect.Effect<void> {
  return tree.signal(signal).pipe(
    Effect.flatMap((alive) => alive ? Effect.sleep(TREE_POLL_MS).pipe(Effect.andThen(Effect.suspend(loop))) : Effect.void),
  );
});

/** Windows has no POSIX signals; taskkill /T ends the tree, and it is always forceful. */
const taskkill = (child: ChildProcess): Effect.Effect<void> => Effect.callback((resume: (effect: Effect.Effect<void>) => void) => {
  if (child.pid === undefined) {
    resume(Effect.void);
    return;
  }
  const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  const done = (failure: string | null) => {
    if (failure) console.error(`[sync-server] taskkill could not stop refresh process ${String(child.pid)}: ${failure}`);
    resume(Effect.void);
  };
  killer.once('error', (error) => { done(error.message); });
  // Exit code 128 means the process had already exited.
  killer.once('exit', (code) => { done(code === 0 || code === 128 || child.exitCode !== null ? null : `exit code ${String(code)}`); });
});

/**
 * Stop a child and its descendants and wait until they have exited, so a later
 * refresh never overlaps a script that is still writing data. SIGTERM first, then SIGKILL.
 */
const stopChild = (child: ChildProcess, grace: StopGrace): Effect.Effect<void> => {
  const tree = new ProcessTree(child);
  // On Windows both phases run taskkill, so a failed first attempt is retried.
  const stopped = (signal: NodeJS.Signals): Effect.Effect<void> => IS_WINDOWS
    ? taskkill(child).pipe(Effect.andThen(exited(child)))
    : signalUntilExited(tree, signal);
  return stopped('SIGTERM').pipe(Effect.timeoutOrElse({
    duration: grace.termGraceMs,
    orElse: () => stopped('SIGKILL').pipe(Effect.timeoutOrElse({
      duration: grace.killGraceMs,
      orElse: () => Effect.sync(() => {
        console.error(`[sync-server] Refresh process ${String(child.pid)} or a descendant did not exit after SIGKILL`);
      }),
    })),
  }));
};

function runCommand(
  command: string,
  args: readonly string[],
  onOutput: (text: string) => void,
  grace: StopGrace = { termGraceMs: TERM_GRACE_MS, killGraceMs: KILL_GRACE_MS }
): Effect.Effect<void, Error> {
  return Effect.callback((resume: (effect: Effect.Effect<void, Error>) => void) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Node can only launch pnpm.cmd through a shell on Windows.
      shell: IS_WINDOWS,
    });
    // Mirror output in the server terminal so the refresh reads like `pnpm dev:live`.
    child.stdout?.on('data', (chunk: Buffer) => { process.stdout.write(chunk); onOutput(chunk.toString('utf8')); });
    child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(chunk); onOutput(chunk.toString('utf8')); });
    child.once('error', (error) => { resume(Effect.fail(error)); });
    // `close` waits for stdout and stderr to drain, so failure details include the last lines.
    child.once('close', (code, signal) => {
      resume(code === 0 ? Effect.void : Effect.fail(new Error(signal ? `stopped by ${signal}` : `exit code ${String(code)}`)));
    });
    // Interruption (timeout or shutdown) completes only after the process has exited.
    return stopChild(child, grace);
  });
}

const runPnpmScript: RunRefreshScript = (script, onOutput) => runCommand(PNPM_COMMAND, [script], onOutput);

/** Exposed for tests of process shutdown. */
export const refreshProcessInternals = { runCommand };

const describeDuration = (ms: number): string => ms % 60_000 === 0
  ? `${String(ms / 60_000)} minute${ms === 60_000 ? '' : 's'}`
  : `${String(ms)} ms`;

function lastLines(output: string): string | null {
  const lines = output
    // eslint-disable-next-line no-control-regex -- strips terminal color codes from script output
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.slice(-DETAIL_LINES).join('\n') : null;
}

function initialStatus(): DraftDataRefreshStatus {
  return {
    state: 'idle',
    steps: DRAFT_DATA_REFRESH_STEPS.map((step) => ({ key: step.key, label: step.label, state: 'pending' })),
    startedAt: null,
    finishedAt: null,
    error: null,
    detail: null,
  };
}

/** Single-flight refresh of the Core Draft Data the live preflight prepares. */
export class DraftDataRefreshJob {
  private status: DraftDataRefreshStatus = initialStatus();
  private fiber: Fiber.Fiber<void> | null = null;
  private disposed = false;

  constructor(
    private readonly runScript: RunRefreshScript = runPnpmScript,
    private readonly now: () => Date = () => new Date(),
    private readonly stepTimeoutMs: number = STEP_TIMEOUT_MS
  ) {}

  getStatus(): DraftDataRefreshStatus {
    return this.status;
  }

  /** Starts a refresh, or returns the one already running. */
  start(): DraftDataRefreshStatus {
    if (this.status.state === 'running' || this.disposed) return this.status;
    this.status = { ...initialStatus(), state: 'running', startedAt: this.now().toISOString() };
    // A fast runner can finish before runFork returns, so report the status at start.
    const started = this.status;
    this.fiber = Effect.runFork(this.run());
    return started;
  }

  dispose(): void {
    this.disposed = true;
    if (this.fiber) Effect.runFork(Fiber.interrupt(this.fiber));
    this.fiber = null;
  }

  private setStep(index: number, state: DraftDataRefreshStepState): void {
    this.status = {
      ...this.status,
      steps: this.status.steps.map((step, stepIndex) => stepIndex === index ? { ...step, state } : step),
    };
  }

  private run(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      for (const [index, step] of DRAFT_DATA_REFRESH_STEPS.entries()) {
        this.setStep(index, 'running');
        let output = '';
        const result = yield* Effect.result(this.runScript(step.script, (text) => {
          output = (output + text).slice(-MAX_OUTPUT_CHARS);
        }).pipe(Effect.timeoutOrElse({
          duration: this.stepTimeoutMs,
          orElse: () => Effect.fail(new Error(`timed out after ${describeDuration(this.stepTimeoutMs)}`)),
        })));
        if (result._tag === 'Failure') {
          this.setStep(index, 'failed');
          this.status = {
            ...this.status,
            state: 'failed',
            finishedAt: this.now().toISOString(),
            error: `${step.label} refresh failed (${result.failure.message}).`,
            detail: lastLines(output),
          };
          return;
        }
        this.setStep(index, 'succeeded');
      }
      this.status = { ...this.status, state: 'succeeded', finishedAt: this.now().toISOString() };
    });
  }
}
