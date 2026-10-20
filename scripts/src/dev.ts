import { Processes, runNodeMain } from '@fantasy-draft/shared/node';
import { fileURLToPath } from 'node:url';

await runNodeMain(async signal => {
  const services = ['dev:shared', 'dev:web', 'dev:server', 'dev:extension'].map(script =>
    Processes.service(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [script], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)), env: process.env,
      shell: process.platform === 'win32', output: 'inherit', stdin: 'inherit',
      signal, timeoutMs: 24 * 60 * 60_000, termGraceMs: 20_000,
    }));
  try {
    await Promise.all(services.map(service => service.result));
  } finally {
    await Promise.all(services.map(service => service.stop()));
  }
});
