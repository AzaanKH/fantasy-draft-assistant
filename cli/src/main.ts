import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runDraft } from './run';

const controller = new AbortController();
const stop = () => { controller.abort(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
// A downstream pipe such as head may close a watch stream at any point.
process.stdout.on('error', error => {
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') controller.abort();
  else throw error;
});
try {
  process.exitCode = await runDraft(process.argv.slice(2), {
    stdout: async text => {
      if (!controller.signal.aborted && !process.stdout.write(text)) await once(process.stdout, 'drain', { signal: controller.signal });
    },
    stderr: text => { process.stderr.write(text); },
  }, {
    root: process.env.DRAFT_ROOT ?? fileURLToPath(new URL(/* @vite-ignore */ '../..', import.meta.url)),
    env: process.env, signal: controller.signal,
  });
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
