import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { DraftDataRefreshJob, type RunRefreshScript } from './draft-data-refresh.js';

interface PendingRun {
  readonly script: string;
  readonly output: (text: string) => void;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

function createControlledRunner(): { readonly runner: RunRefreshScript; readonly runs: PendingRun[] } {
  const runs: PendingRun[] = [];
  const runner: RunRefreshScript = (script, output) => Effect.callback((resume: (effect: Effect.Effect<void, Error>) => void) => {
    runs.push({ script, output, resolve: () => { resume(Effect.void); }, reject: (error) => { resume(Effect.fail(error)); } });
  });
  return { runner, runs };
}

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('DraftDataRefreshJob', () => {
  it('runs the preflight scripts in order and reports each step', async () => {
    const { runner, runs } = createControlledRunner();
    const job = new DraftDataRefreshJob(runner, () => new Date('2026-10-02T12:00:00.000Z'));

    expect(job.start().state).toBe('running');
    await flush();
    expect(runs.map((run) => run.script)).toEqual(['refresh:sleeper']);
    expect(job.getStatus().steps.map((step) => step.state)).toEqual(['running', 'pending', 'pending']);

    for (let index = 0; index < 3; index += 1) {
      runs[index]?.resolve();
      await flush();
    }

    expect(runs.map((run) => run.script)).toEqual(['refresh:sleeper', 'refresh:fantasypros', 'data:identity']);
    expect(job.getStatus()).toMatchObject({
      state: 'succeeded',
      startedAt: '2026-10-02T12:00:00.000Z',
      finishedAt: '2026-10-02T12:00:00.000Z',
      error: null,
    });
  });

  it('starts only one refresh at a time', async () => {
    const { runner, runs } = createControlledRunner();
    const job = new DraftDataRefreshJob(runner);
    job.start();
    job.start();
    await flush();
    expect(runs).toHaveLength(1);
  });

  it('stops at the failed step and keeps its last output lines', async () => {
    const { runner, runs } = createControlledRunner();
    const job = new DraftDataRefreshJob(runner);
    job.start();
    runs[0]?.resolve();
    await flush();
    runs[1]?.output('Fetching rankings\n\u001b[31mFANTASYPROS_API_KEY is not set\u001b[0m\n');
    runs[1]?.reject(new Error('exit code 1'));
    await flush();

    expect(job.getStatus()).toMatchObject({
      state: 'failed',
      error: 'FantasyPros rankings refresh failed (exit code 1).',
      detail: 'Fetching rankings\nFANTASYPROS_API_KEY is not set',
    });
    expect(job.getStatus().steps.map((step) => step.state)).toEqual(['succeeded', 'failed', 'pending']);
    expect(runs).toHaveLength(2);

    job.start();
    await flush();
    expect(runs).toHaveLength(3);
    expect(job.getStatus().steps.map((step) => step.state)).toEqual(['running', 'pending', 'pending']);
  });
});
