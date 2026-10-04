import { spawn, type ChildProcess } from 'node:child_process';
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
// How often to check whether descendants are still running after the child has exited.
const GROUP_POLL_MS = 50;

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

/** Signal the child's whole process group; a pnpm script runs its work in descendants. */
const signalTree = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid === undefined) return;
  if (IS_WINDOWS) {
    // Windows has no process groups; taskkill /T ends the tree, and it is always forceful.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).once('error', () => undefined);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH: every process in the group has already exited.
  }
};

const treeAlive = (child: ChildProcess): boolean => {
  if (IS_WINDOWS || child.pid === undefined) return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Wait for the child and, on POSIX, every process left in its group. */
const treeExited = (child: ChildProcess): Effect.Effect<void> => exited(child).pipe(
  Effect.andThen(Effect.suspend(function poll(): Effect.Effect<void> {
    return treeAlive(child) ? Effect.sleep(GROUP_POLL_MS).pipe(Effect.andThen(Effect.suspend(poll))) : Effect.void;
  })),
);

/**
 * Stop a child and its descendants and wait until they have exited, so a later
 * refresh never overlaps a script that is still writing data. SIGTERM first, then SIGKILL.
 */
const stopChild = (child: ChildProcess, grace: StopGrace): Effect.Effect<void> => Effect.sync(() => { signalTree(child, 'SIGTERM'); }).pipe(
  Effect.andThen(treeExited(child).pipe(Effect.timeoutOrElse({
    duration: grace.termGraceMs,
    orElse: () => Effect.sync(() => { signalTree(child, 'SIGKILL'); }).pipe(
      Effect.andThen(treeExited(child).pipe(Effect.timeoutOrElse({
        duration: grace.killGraceMs,
        orElse: () => Effect.sync(() => {
          console.error(`[sync-server] Refresh process ${String(child.pid)} or a descendant did not exit after SIGKILL`);
        }),
      }))),
    ),
  }))),
);

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
      // Lead a new process group on POSIX, so stopping the refresh reaches the script under pnpm.
      detached: !IS_WINDOWS,
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
