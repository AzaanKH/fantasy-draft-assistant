import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Effect, Fiber } from 'effect';
import {
  DRAFT_DATA_REFRESH_STEPS,
  type DraftDataRefreshStatus,
  type DraftDataRefreshStepState,
} from '@fantasy-draft/shared';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const STEP_TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_CHARS = 8_000;
const DETAIL_LINES = 6;

/**
 * Runs one fixed package script. The web client can only choose to start the whole refresh.
 * Interrupting the effect must stop the script.
 */
export type RunRefreshScript = (
  script: string,
  onOutput: (text: string) => void
) => Effect.Effect<void, Error>;

const runPnpmScript: RunRefreshScript = (script, onOutput) => Effect.callback((resume: (effect: Effect.Effect<void, Error>) => void) => {
  const child = spawn(PNPM_COMMAND, [script], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Node can only launch pnpm.cmd through a shell on Windows.
    shell: process.platform === 'win32',
  });
  // Mirror output in the server terminal so the refresh reads like `pnpm dev:live`.
  child.stdout.on('data', (chunk: Buffer) => { process.stdout.write(chunk); onOutput(chunk.toString('utf8')); });
  child.stderr.on('data', (chunk: Buffer) => { process.stderr.write(chunk); onOutput(chunk.toString('utf8')); });
  child.once('error', (error) => { resume(Effect.fail(error)); });
  child.once('exit', (code, signal) => {
    resume(code === 0 ? Effect.void : Effect.fail(new Error(signal ? `stopped by ${signal}` : `exit code ${String(code)}`)));
  });
  return Effect.sync(() => { child.kill('SIGTERM'); });
});

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
    private readonly now: () => Date = () => new Date()
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
          duration: STEP_TIMEOUT_MS,
          orElse: () => Effect.fail(new Error(`timed out after ${String(STEP_TIMEOUT_MS / 60_000)} minutes`)),
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
