import { Processes, ProcessError } from '@fantasy-draft/shared/node';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { Effect, Fiber } from 'effect';
import {
  DRAFT_DATA_REFRESH_STEPS,
  type DraftDataRefreshStatus,
  type DraftDataRefreshStepState,
} from '@fantasy-draft/shared/catalog';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IS_WINDOWS = process.platform === 'win32';
const PNPM_COMMAND = IS_WINDOWS ? 'pnpm.cmd' : 'pnpm';
const STEP_TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_CHARS = 8_000;
const DETAIL_LINES = 6;

export type RunRefreshScript = (
  script: string,
  onOutput: (text: string) => void
) => Effect.Effect<void, Error>;

function runCommand(
  command: string,
  args: readonly string[],
  onOutput: (text: string) => void,
  grace = { termGraceMs: 10_000, killGraceMs: 5000 },
): Effect.Effect<void, Error> {
  return Effect.callback((resume) => {
    const service = Processes.service(command, args, {
      cwd: REPO_ROOT, env: process.env, shell: IS_WINDOWS,
      timeoutMs: STEP_TIMEOUT_MS, ...grace, output: 'tee',
      onStdout: onOutput, onStderr: onOutput,
    });
    void service.result.then(
      () => { resume(Effect.void); },
      (error: unknown) => {
        const failure = error instanceof ProcessError && error.kind === 'exit'
          ? new Error(error.result.signal ? `stopped by ${error.result.signal}` : `exit code ${String(error.exitCode)}`)
          : error instanceof Error ? error : new Error(String(error));
        resume(Effect.fail(failure));
      },
    );
    return Effect.promise(() => service.stop());
  });
}

const runPnpmScript: RunRefreshScript = (script, onOutput) => runCommand(PNPM_COMMAND, [script], onOutput);
export const refreshProcessInternals = { runCommand };

const describeDuration = (ms: number): string => ms % 60_000 === 0
  ? `${String(ms / 60_000)} minute${ms === 60_000 ? '' : 's'}`
  : `${String(ms)} ms`;

function lastLines(output: string): string | null {
  const lines = stripVTControlCharacters(output)
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
