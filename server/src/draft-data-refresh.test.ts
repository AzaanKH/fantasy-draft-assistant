import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { Effect, Fiber } from 'effect';
import { DraftDataRefreshJob, refreshProcessInternals, type RunRefreshScript } from './draft-data-refresh.js';

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

describe('DraftDataRefreshJob timeouts', () => {
  it('stays running until a timed-out script has stopped, so a restart cannot overlap it', async () => {
    const runs: string[] = [];
    let stopped = false;
    // Interruption cleanup that takes a while, like a child process slow to exit.
    const runner: RunRefreshScript = (script) => Effect.callback(() => {
      runs.push(script);
      return Effect.sleep(150).pipe(Effect.andThen(Effect.sync(() => { stopped = true; })));
    });
    const job = new DraftDataRefreshJob(runner, () => new Date('2026-10-02T12:00:00.000Z'), 30);
    job.start();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(stopped).toBe(false);
    expect(job.getStatus().state).toBe('running');
    expect(job.start().state).toBe('running');
    expect(runs).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(stopped).toBe(true);
    expect(job.getStatus()).toMatchObject({ state: 'failed', error: 'Sleeper player directory refresh failed (timed out after 30 ms).' });
  });
});

describe('refresh script processes', () => {
  const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // A killed orphan stays visible as a zombie until init reaps it, which takes a moment.
  const isReaped = async (pid: number) => {
    for (let waited = 0; waited < 1000 && isAlive(pid); waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
    return !isAlive(pid);
  };

  it('escalates to SIGKILL and waits for exit when a script ignores SIGTERM', async () => {
    let output = '';
    const fiber = Effect.runFork(refreshProcessInternals.runCommand(process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); console.log(process.pid); setInterval(() => {}, 1000);"],
      (text) => { output += text; }, { termGraceMs: 100, killGraceMs: 2000 }));
    while (!/\d+/.test(output)) await new Promise((resolve) => setTimeout(resolve, 10));
    const pid = Number(/\d+/.exec(output)?.[0]);

    const started = Date.now();
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(isAlive(pid)).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('collects all output before reporting a failed script', async () => {
    const mirror = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      let output = '';
      const exit = await Effect.runPromiseExit(refreshProcessInternals.runCommand(process.execPath,
        // The script exits first; a process it started still holds stderr and writes the last line.
        ['-e', "require('child_process').spawn(process.execPath, ['-e', \"setTimeout(() => console.error('last line'), 200)\"], { stdio: 'inherit' }); process.exit(1);"],
        (text) => { output += text; }));
      expect(exit._tag).toBe('Failure');
      expect(output.endsWith('last line\n')).toBe(true);
    } finally { mirror.mockRestore(); }
  });

  it.skipIf(process.platform === 'win32')('keeps scripts in the server process group, so a supervisor killing the group stops them', async () => {
    const pgid = (pid: number) => execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    let output = '';
    const fiber = Effect.runFork(refreshProcessInternals.runCommand(process.execPath,
      ['-e', 'console.log(process.pid); setInterval(() => {}, 1000);'], (text) => { output += text; }));
    while (!/\d+/.test(output)) await new Promise((resolve) => setTimeout(resolve, 10));

    expect(pgid(Number(/\d+/.exec(output)?.[0]))).toBe(pgid(process.pid));
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  it.skipIf(process.platform === 'win32')('stops descendants that outlive the child, as a script under pnpm would', async () => {
    // The parent exits on SIGTERM like pnpm; its grandchild ignores SIGTERM and keeps running.
    const grandchild = "process.on('SIGTERM', () => {}); console.log('grandchild', process.pid); setInterval(() => {}, 1000);";
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;
    let output = '';
    const fiber = Effect.runFork(refreshProcessInternals.runCommand(process.execPath, ['-e', parent],
      (text) => { output += text; }, { termGraceMs: 200, killGraceMs: 2000 }));
    while (!/grandchild \d+/.test(output)) await new Promise((resolve) => setTimeout(resolve, 10));
    const pid = Number(/grandchild (\d+)/.exec(output)?.[1]);

    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(await isReaped(pid)).toBe(true);
  });
});
