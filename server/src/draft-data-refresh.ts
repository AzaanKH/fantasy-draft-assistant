import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

export interface RefreshScriptRun {
  readonly done: Promise<void>;
  readonly cancel: () => void;
}

/** Runs one fixed package script. The web client can only choose to start the whole refresh. */
export type RunRefreshScript = (
  script: string,
  onOutput: (text: string) => void
) => RefreshScriptRun;

export const runPnpmScript: RunRefreshScript = (script, onOutput) => {
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
  const timeout = setTimeout(() => { child.kill('SIGTERM'); }, STEP_TIMEOUT_MS);
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(signal ? `stopped by ${signal}` : `exit code ${String(code)}`));
    });
  });
  return { done, cancel: () => { child.kill('SIGTERM'); } };
};

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
  private currentRun: RefreshScriptRun | null = null;
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
    void this.run();
    return this.status;
  }

  dispose(): void {
    this.disposed = true;
    this.currentRun?.cancel();
  }

  private setStep(index: number, state: DraftDataRefreshStepState): void {
    this.status = {
      ...this.status,
      steps: this.status.steps.map((step, stepIndex) => stepIndex === index ? { ...step, state } : step),
    };
  }

  private async run(): Promise<void> {
    for (const [index, step] of DRAFT_DATA_REFRESH_STEPS.entries()) {
      if (this.disposed) return;
      this.setStep(index, 'running');
      let output = '';
      try {
        this.currentRun = this.runScript(step.script, (text) => {
          output = (output + text).slice(-MAX_OUTPUT_CHARS);
        });
        await this.currentRun.done;
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        this.setStep(index, 'failed');
        this.status = {
          ...this.status,
          state: 'failed',
          finishedAt: this.now().toISOString(),
          error: `${step.label} refresh failed (${reason}).`,
          detail: lastLines(output),
        };
        return;
      } finally {
        this.currentRun = null;
      }
      this.setStep(index, 'succeeded');
    }
    this.status = { ...this.status, state: 'succeeded', finishedAt: this.now().toISOString() };
  }
}
