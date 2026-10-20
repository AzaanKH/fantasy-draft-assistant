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
