import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Processes, ProcessError } from './processes.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function treeFixture(): Promise<{ file: string; args: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'process-runner-'));
  temporary.push(dir);
  const file = join(dir, 'pids.json');
  const grandchild = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
  const parent = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' });
    require('node:fs').writeFileSync(${JSON.stringify(file)}, JSON.stringify([process.pid, child.pid]));
    console.log('ready');
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `;
  return { file, args: ['-e', parent] };
}

async function readPids(file: string): Promise<number[]> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(value) || !value.every((pid): pid is number => typeof pid === 'number')) throw new Error('Invalid fixture PIDs');
  return value;
}

describe('Processes', () => {
  it('captures stdout and stderr and drains the last output', async () => {
    const result = await Processes.run(process.execPath, ['-e', "console.log('out'); console.error('err')"], { timeoutMs: 5000 });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'out\n', stderr: 'err\n', stdoutTruncated: false, stderrTruncated: false });
  });
  it('reports typed non-zero exits without retaining environment secrets', async () => {
    const error = await Processes.run(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 5000, env: { ...process.env, PRIVATE_TEST_TOKEN: 'never-serialize-me' } }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ProcessError);
    expect(error).toMatchObject({ kind: 'exit', command: process.execPath, exitCode: 7 });
    expect(JSON.stringify(error)).not.toContain('never-serialize-me');
    expect(String(error)).not.toContain('never-serialize-me');
  });
  it('caps each captured stream and keeps the tail', async () => {
    const result = await Processes.run(process.execPath, ['-e', "process.stdout.write('a'.repeat(10000) + 'TAIL'); process.stderr.write('b'.repeat(10000))"], { timeoutMs: 5000, maxOutputBytes: 128 });
    expect(Buffer.byteLength(result.stdout)).toBe(128);
    expect(Buffer.byteLength(result.stderr)).toBe(128);
    expect(result.stdout.endsWith('TAIL')).toBe(true);
    expect(result).toMatchObject({ stdoutTruncated: true, stderrTruncated: true });
  });
  it('bounds decoded UTF-8 output even when the tail begins inside a character', async () => {
    const result = await Processes.run(process.execPath, ['-e', "process.stdout.write('😀'.repeat(1000) + 'END')"], { timeoutMs: 5000, maxOutputBytes: 128 });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(128);
    expect(result.stdout.endsWith('END')).toBe(true);
  });
  it('child-exit-after-cancel waits for the child and grandchild to die', async () => {
    const fixture = await treeFixture();
    const abort = new AbortController();
    const result = Processes.run(process.execPath, fixture.args, {
      timeoutMs: 5000, signal: abort.signal, termGraceMs: 50,
      onStdout: () => { abort.abort(); },
    }).catch((error: unknown) => error);
    expect(await result).toMatchObject({ kind: 'aborted' });
    for (const pid of await readPids(fixture.file)) expect(alive(pid), `PID ${pid} survived cancellation`).toBe(false);
  });
  it('timeout kills the whole group and waits for exit', async () => {
    const fixture = await treeFixture();
    const error = await Processes.run(process.execPath, fixture.args, { timeoutMs: 300, termGraceMs: 50 }).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: 'timeout' });
    for (const pid of await readPids(fixture.file)) expect(alive(pid), `PID ${pid} survived timeout`).toBe(false);
  });
  it('stops a service idempotently and waits for its group', async () => {
    const fixture = await treeFixture();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const service = Processes.service(process.execPath, fixture.args, { timeoutMs: 5000, termGraceMs: 50, onStdout: () => { ready(); } });
    await started;
    const result = service.result.catch((error: unknown) => error);
    await Promise.all([service.stop(), service.stop()]);
    expect(await result).toMatchObject({ kind: 'aborted' });
    for (const pid of await readPids(fixture.file)) expect(alive(pid)).toBe(false);
  });
  it('does not spawn with an already aborted signal', async () => {
    const fixture = await treeFixture();
    const signal = AbortSignal.abort();
    await expect(Processes.run(process.execPath, fixture.args, { timeoutMs: 5000, signal })).rejects.toMatchObject({ kind: 'aborted' });
    await expect(readFile(fixture.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('stops a child if an output observer throws', async () => {
    await expect(Processes.run(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], {
      timeoutMs: 5000, onStdout: () => { throw new Error('observer failed'); },
    })).rejects.toMatchObject({ kind: 'output' });
  });
  it('reports spawn failures as typed errors', async () => {
    await expect(Processes.run('/no-such-process-u09', [], { timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'spawn', exitCode: null });
  });
});

it.skipIf(process.platform === 'win32')('stops a nested process group even after its watcher kills the nested owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nested-runner-'));
  temporary.push(dir);
  const file = join(dir, 'pid');
  const nested = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(file)}, String(process.pid)); console.log('ready'); setInterval(() => {}, 1000);`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(nested)}], { detached: true, stdio: 'inherit' }); setInterval(() => {}, 1000);`;
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const service = Processes.service(process.execPath, ['-e', parent], { timeoutMs: 5000, termGraceMs: 50, onStdout: () => { ready(); } });
  let pid: number | undefined;
  try {
    await started;
    pid = Number(await readFile(file, 'utf8'));
    let deadline!: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([service.stop(), new Promise<never>((_, reject) => {
        deadline = setTimeout(() => { reject(new Error('Nested group survived shutdown')); }, 1000);
      })]);
    } finally { clearTimeout(deadline); }
    expect(alive(pid)).toBe(false);
  } finally {
    if (pid !== undefined) { try { process.kill(-pid, 'SIGKILL'); } catch { /* Fixture already stopped. */ } }
    await service.stop();
  }
});

it('does not signal an unrelated service while stopping an owned group', async () => {
  const other = Processes.service(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5000 });
  const owned = Processes.service(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5000 });
  try {
    await owned.stop();
    expect(other.pid).toBeTypeOf('number');
    expect(alive(other.pid!)).toBe(true);
  } finally { await Promise.all([owned.stop(), other.stop()]); }
});
