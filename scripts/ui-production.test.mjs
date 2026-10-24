import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Processes } from '@fantasy-draft/shared/node';
import { http } from '@fantasy-draft/shared/http';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { assertProductionEnvironment, inspectProductionBuild, createStaticHandler, verifyProductionHttp, verifyFixtureHttp } from './persistence/ui-production.mjs';
import { buildReadinessFixture } from './persistence/ui-readiness.mjs';
import { buildCatalogFixture } from './persistence/ui-adapter.mjs';

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
  const processProofOutput = path.join(directory, 'process.json');
  await writeFile(input, JSON.stringify({ ids: ['1700000000009'], teams: 20, rounds: 20, output, processProofOutput }));
  const require = createRequire(import.meta.url);
  await Processes.run(process.execPath, [require.resolve('tsx/cli'), '--conditions=@fantasy-draft/source', new URL('./persistence/ui-seed.mjs', import.meta.url).pathname, input], { timeoutMs: 15000 });
  const child = JSON.parse(await readFile(processProofOutput, 'utf8'));
  expect(child.execArgv).toContain('--conditions=@fantasy-draft/source');
  const rows = JSON.parse(await readFile(output, 'utf8'));
  const session = JSON.parse(rows.find(([key]) => key === 'fantasy-draft-session-v1:sleeper:1700000000009')[1]);
  expect(session.config).toMatchObject({ totalTeams: 20, totalRounds: 20, draftType: 'linear', myPickPosition: 1 });
  expect(session.identity).toEqual({ provider: 'sleeper', draftId: '1700000000009' });
  expect(session.draftHistory).toEqual([]);
  expect(rows.some(([key]) => key === 'fantasy-draft-storage-migrated')).toBe(false);
});

test('preflight imports legitimate queue fixtures through v1 before activation with no tombstone or counted browser commands', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ui-preflight-seed-'));
  const input = path.join(directory, 'input.json'), output = path.join(directory, 'output.json');
  const leaguePreferences = { profile: 'quick-mock', quickMock: { totalTeams: 20, totalRounds: 20, reception: 1, passingTouchdown: 4 } };
  await writeFile(input, JSON.stringify({ ids: ['1800000000001', '1800000000002'], teams: 20, rounds: 20, output,
    queues: { '1800000000002': ['9221', '9509', '4034', '9493'] }, leaguePreferences }));
  const require = createRequire(import.meta.url);
  await Processes.run(process.execPath, [require.resolve('tsx/cli'), '--conditions=@fantasy-draft/source', new URL('./persistence/ui-seed.mjs', import.meta.url).pathname, input], { timeoutMs: 15000 });
  const rows = new Map(JSON.parse(await readFile(output, 'utf8')));
  expect(JSON.parse(rows.get('fantasy-draft-session-v1:sleeper:1800000000001')).shortlistedPlayerIds).toEqual([]);
  expect(JSON.parse(rows.get('fantasy-draft-session-v1:sleeper:1800000000002')).shortlistedPlayerIds).toEqual(['9221', '9509', '4034', '9493']);
  expect(JSON.parse(rows.get('fantasy-draft-league-setup-v1'))).toEqual(leaguePreferences);
  expect(rows.has('fantasy-draft-storage-migrated')).toBe(false);
});

test('actual static fixture endpoints provide decoded readiness inputs while unknown APIs and refresh writes stay unavailable', async () => {
  const data = await Promise.all(['fantasypros-snapshot', 'player-identity', 'predictions', 'sleeper-adp'].map(async name => JSON.parse(await readFile(new URL(`../demo-data/${name}.json`, import.meta.url), 'utf8'))));
  const { snapshot, catalog } = buildCatalogFixture(...data.slice(0, 3));
  const ready = buildReadinessFixture({ snapshot, identities: data[1], sleeper: data[3], catalog });
  const source = await readFile(new URL('./persistence/ui-activation.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function createFixture()'), source.indexOf('\nlet server;'));
  const fixture = runInNewContext(`(${code})()`, { URL, TEAMS: 20, ROUNDS: 20, setInterval, clearInterval });
  fixture.readiness(ready.files);
  const dist = await mkdtemp(path.join(tmpdir(), 'ui-ready-http-'));
  await writeFile(path.join(dist, 'index.html'), '<main>ordinary production app</main>');
  const server = createServer(createStaticHandler({ dist, fixture: fixture.handler }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    expect(Object.keys(await verifyFixtureHttp(origin, ready.files))).toHaveLength(7);
    await expect(http.text(`${origin}/api/draft-data/refresh`, { timeoutMs: 5000, retries: 0, retryAfter: false }, { init: { method: 'POST' } })).rejects.toMatchObject({ status: 405 });
    await expect(http.text(`${origin}/api/unimplemented`, { timeoutMs: 5000, retries: 0, retryAfter: false })).rejects.toMatchObject({ status: 503 });
  } finally { fixture.stop(); await new Promise(resolve => server.close(resolve)); }
});

test('the real runner seeds v1 bytes with an effective source condition in its child process', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ui-runner-seed-'));
  const runner = await readFile(new URL('./persistence/ui-activation.mjs', import.meta.url), 'utf8');
  const code = runner.slice(runner.indexOf('async function seedV1('), runner.indexOf('async function activateThroughPrompt('));
  const values = new Map(); const navigations = []; const results = { progress: [] };
  const page = { goto: async url => navigations.push(url), evaluate: async (fn, entries) => runInNewContext(`(${fn.toString()})(entries)`, {
    entries, localStorage: { setItem: (key, value) => values.set(key, value) },
  }) };
  const seed = runInNewContext(`(${code})`, { seedSequence: 0, process, path, outDir: directory, writeFile, readFile, Processes,
    requireScripts: createRequire(import.meta.url), here: new URL('./persistence/', import.meta.url).pathname,
    root: new URL('..', import.meta.url).pathname, TEAMS: 20, ROUNDS: 20, results, origin: 'http://localhost:3000',
    check: (condition, message) => { if (!condition) throw new Error(message); },
  });
  expect(await seed(page, ['1700000000009'])).toBeGreaterThan(0);
  expect(navigations).toEqual(['http://localhost:3000/__ui-fixture/blank']);
  expect(results.progress[0].execArgv).toContain('--conditions=@fantasy-draft/source');
  expect(JSON.parse(values.get('fantasy-draft-session-v1:sleeper:1700000000009')).config).toMatchObject({ totalTeams: 20, totalRounds: 20, draftType: 'linear' });
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
