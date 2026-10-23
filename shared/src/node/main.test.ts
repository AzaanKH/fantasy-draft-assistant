import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Processes } from './processes.js';

const mainUrl = pathToFileURL(`${import.meta.dirname}/main.ts`).href;
const run = (body: string) => Processes.run(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
  import { runNodeMain } from ${JSON.stringify(mainUrl)};
  ${body}
`], { timeoutMs: 5000 });

describe('runNodeMain', () => {
  it('preserves a program-selected exit code', async () => {
    await expect(run('await runNodeMain(async () => { process.exitCode = 3; });')).rejects.toMatchObject({ exitCode: 3 });
  });
  it('reports ordinary failures with exit code 1 and the supplied label', async () => {
    await expect(run("await runNodeMain(async () => { throw new Error('fixture failed'); }, { failureLabel: 'Fixture:' });")).rejects.toMatchObject({ exitCode: 1, stderr: expect.stringContaining('Fixture: Error: fixture failed') });
  });
  it('waits for signal cleanup even after repeated signals', async () => {
    await expect(run(`
      await runNodeMain(async signal => {
        const stopped = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        setTimeout(() => { process.kill(process.pid, 'SIGTERM'); }, 20);
        setTimeout(() => { process.kill(process.pid, 'SIGINT'); }, 30);
        await stopped;
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('cleanup finished');
      });
    `)).rejects.toMatchObject({ exitCode: 130, result: expect.objectContaining({ stdout: 'cleanup finished\n' }) });
  });
});

it.skipIf(process.platform === 'win32')('SIGHUP stops an owned child before the main process exits', async () => {
  const tsx = new URL('../../../scripts/node_modules/tsx/dist/loader.mjs', import.meta.url).href;
  const parent = spawn(process.execPath, ['--import', tsx, '--eval', `
    const { runNodeMain } = require(${JSON.stringify(new URL('./main.ts', import.meta.url).pathname)});
    const { Processes } = require(${JSON.stringify(new URL('./processes.ts', import.meta.url).pathname)});
    runNodeMain(async signal => {
      const service = Processes.service(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5000, signal });
      console.log(service.pid);
      await service.result;
    });
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let pid: number | undefined;
  try {
    const [chunk] = await once(parent.stdout, 'data');
    pid = Number(String(chunk).trim());
    expect(Number.isInteger(pid)).toBe(true);
    const closed = once(parent, 'close');
    parent.kill('SIGHUP');
    await closed;
    expect(() => process.kill(pid!, 0)).toThrow();
  } finally {
    if (pid !== undefined) { try { process.kill(-pid, 'SIGKILL'); } catch { /* Fixture already stopped. */ } }
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
  }
});
