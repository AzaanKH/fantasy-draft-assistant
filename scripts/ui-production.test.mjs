import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Processes } from '@fantasy-draft/shared/node';
import { http } from '@fantasy-draft/shared/http';
import { createRequire } from 'node:module';
import { assertProductionEnvironment, inspectProductionBuild, createStaticHandler, verifyProductionHttp } from './persistence/ui-production.mjs';

const env = { MODE: 'production', DEV: false, PROD: true, VITE_STORAGE_ACTIVATION: 'idb' };
test('production proof rejects dev mode, the harness and static demo mode', () => {
  expect(() => assertProductionEnvironment(env)).not.toThrow();
  for (const overrides of [{ DEV: true }, { MODE: 'development' }, { PROD: false }, { VITE_STORAGE_ACTIVATION: 'v1' }, { VITE_PERSISTENCE_HARNESS: 'idb' }, { VITE_DEMO_MODE: 'true' }]) expect(() => assertProductionEnvironment({ ...env, ...overrides })).toThrow();
});
test('production static HTTP serves exact built bytes and rejects every dev runtime route', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'ui-production-'));
  await mkdir(path.join(dist, 'assets'));
  await writeFile(path.join(dist, 'index.html'), '<script type="module" src="/assets/app.js"></script>');
  await writeFile(path.join(dist, 'assets/app.js'), 'console.log("fantasy-draft-workspace-v2 Activate IndexedDB")');
  const build = await inspectProductionBuild(dist, env);
  const server = createServer(createStaticHandler({ dist, fixture: (_request, _response, next) => next() }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const proof = await verifyProductionHttp(`http://127.0.0.1:${server.address().port}`, build);
    expect(Object.keys(proof.verified)).toHaveLength(2);
    expect(Object.values(proof.rejected)).toEqual([404, 404, 404, 404]);
    await writeFile(path.join(dist, 'assets/app.js'), 'changed');
    await expect(verifyProductionHttp(`http://127.0.0.1:${server.address().port}`, build)).rejects.toThrow('bytes differ');
    await writeFile(path.join(dist, 'assets/app.js'), 'import "/@vite/client"');
    await expect(inspectProductionBuild(dist, env)).rejects.toThrow('Development runtime');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('Node creates decodable v1 setup bytes through the real store without serving source to the browser', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ui-seed-'));
  const input = path.join(directory, 'input.json'); const output = path.join(directory, 'output.json');
  await writeFile(input, JSON.stringify({ ids: ['1700000000009'], teams: 20, rounds: 20, output }));
  const require = createRequire(import.meta.url);
  await Processes.run(process.execPath, ['--conditions=@fantasy-draft/source', require.resolve('tsx/cli'), new URL('./persistence/ui-seed.mjs', import.meta.url).pathname, input], { timeoutMs: 15000 });
  const rows = JSON.parse(await readFile(output, 'utf8'));
  const session = JSON.parse(rows.find(([key]) => key === 'fantasy-draft-session-v1:sleeper:1700000000009')[1]);
  expect(session.config).toMatchObject({ totalTeams: 20, totalRounds: 20, draftType: 'linear', myPickPosition: 1 });
  expect(session.identity).toEqual({ provider: 'sleeper', draftId: '1700000000009' });
  expect(session.draftHistory).toEqual([]);
  expect(rows.some(([key]) => key === 'fantasy-draft-storage-migrated')).toBe(false);
});


test('production fixture handles sync-refresh POST while static assets remain read-only', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'ui-production-post-'));
  await writeFile(path.join(dist, 'index.html'), '<main>production</main>');
  const server = createServer(createStaticHandler({ dist, fixture: (request, response, next) => {
    if (request.url !== '/api/sync/sleeper/drafts/123/refresh') { next(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ method: request.method, refreshed: true }));
  } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const policy = { timeoutMs: 5000, retries: 0, retryAfter: false };
  const options = { init: { method: 'POST' } };
  try {
    await expect(http.json(`${origin}/api/sync/sleeper/drafts/123/refresh`, value => value, policy, options)).resolves.toEqual({ method: 'POST', refreshed: true });
    await expect(http.text(`${origin}/index.html`, policy, options)).rejects.toMatchObject({ status: 405 });
    await expect(http.text(`${origin}/src/main.tsx`, policy, options)).rejects.toMatchObject({ status: 404 });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
