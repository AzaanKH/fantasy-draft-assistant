import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, createServer } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { sourceCondition } from '../source-condition.js';
import { noNodeInBrowserBundle } from './no-node-in-browser-bundle.ts';

const repoRoot = new URL('..', import.meta.url).pathname;
const fixtureRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'browser-bundle-')));
symlinkSync(path.join(repoRoot, 'scripts/node_modules'), path.join(fixtureRoot, 'node_modules'));
symlinkSync(path.join(repoRoot, 'server/src'), path.join(fixtureRoot, 'server-source'));
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

const serverSource = path.relative(fixtureRoot, path.join(repoRoot, 'server/src'));
const localAuth = `${serverSource}/local-auth.ts`;
writeFileSync(path.join(fixtureRoot, 'raw-worker.ts'), `import source from '${localAuth}?raw'; postMessage(source);`);

async function bundle(name, source) {
  const entry = path.join(fixtureRoot, `${name}.ts`);
  writeFileSync(entry, source);
  return build({
    ...sourceCondition, root: fixtureRoot, configFile: false, logLevel: 'silent',
    plugins: [noNodeInBrowserBundle()],
    build: { write: false, rollupOptions: { input: entry } },
  });
}

describe('no-node-in-browser-bundle', () => {
  it.each([
    ['shared-node-raw', "import source from '@fantasy-draft/shared/node?raw'; console.log(source);", 'shared/src/node'],
    ['symlink-raw', "import source from './server-source/local-auth.ts?raw'; console.log(source);", 'server/src/local-auth.ts'],
    ['fs-prefix-raw', `import source from '/@fs${repoRoot}server/src/local-auth.ts?raw'; console.log(source);`, 'server/src/local-auth.ts'],
    ['template-import', `const name = String(globalThis.name); void import(\`${serverSource}/\${name}.ts?raw\`).then(console.log);`, 'server/src/'],
    ['glob-raw', `console.log(import.meta.glob('${localAuth}', { query: '?raw', import: 'default', eager: true }));`, 'server/src/local-auth.ts'],
    ['url-asset', `console.log(new URL('${localAuth}', import.meta.url).href);`, 'server/src/local-auth.ts'],
    ['url-inline-asset', `console.log(new URL('${localAuth}?inline', import.meta.url).href);`, 'server/src/local-auth.ts'],
    ['url-large-asset', `console.log(new URL('${serverSource}/sync-server.ts', import.meta.url).href);`, 'server/src/sync-server.ts'],
    ['worker-raw', "new Worker(new URL('./raw-worker.ts', import.meta.url), { type: 'module' });", 'server/src/local-auth.ts'],
    ['server-import',`import { getLocalSyncToken } from '${localAuth}'; console.log(getLocalSyncToken);`, 'server/src/local-auth.ts'],
  ])('fails the build for %s', async (name, source, target) => {
    await expect(bundle(name, source)).rejects.toThrow(new RegExp(`${target}.*browser bundles must not include server/ or shared/src/node`));
  });
  it('rejects Node-only modules requested from the dev server', async () => {
    const server = await createServer({
      root: fixtureRoot, configFile: false, logLevel: 'silent', plugins: [noNodeInBrowserBundle()], server: { middlewareMode: true, ws: false },
    });
    try {
      await expect(server.transformRequest(`/@fs${repoRoot}server/src/local-auth.ts`)).rejects.toThrow('browser bundles must not include server/');
    } finally {
      await server.close();
    }
  });
  it('builds browser-safe shared subpaths and local modules', async () => {
    writeFileSync(path.join(fixtureRoot, 'local.ts'), 'export const label = "local";');
    await expect(bundle('clean', [
      "import { localDevPorts } from '@fantasy-draft/shared/sync';",
      "import { label } from './local';",
      'console.log(localDevPorts(), label);',
    ].join('\n'))).resolves.toBeDefined();
  });
});
