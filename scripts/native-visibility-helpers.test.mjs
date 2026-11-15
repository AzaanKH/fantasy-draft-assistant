import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Processes } from '@fantasy-draft/shared/node';
import { http } from '@fantasy-draft/shared/http';
import { createRequire } from 'node:module';
import { assertProductionEnvironment, inspectProductionBuild, createStaticHandler, verifyProductionHttp, verifyFixtureHttp } from './persistence/ui-production.mjs';
import { buildReadinessFixture } from './persistence/ui-readiness.mjs';
import { buildCatalogFixture } from './persistence/ui-adapter.mjs';

// Helpers of the opt-in native-visibility proof (scripts/persistence/native-visibility.mjs), kept from the removed UI activation tests.
const env = { MODE: 'production', DEV: false, PROD: true, VITE_STORAGE_ACTIVATION: 'idb' };
test('production proof accepts the default activation build', () => {
  expect(() => assertProductionEnvironment({ ...env, VITE_STORAGE_ACTIVATION: undefined })).not.toThrow();
});

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

test.each([
  ['a duplicate FantasyPros identity', (identities) => { identities.players[1] = { ...identities.players[1], fantasyProsId: identities.players[0].fantasyProsId }; }, /unique real canonical/],
  ['a missing Sleeper identity', (identities) => { identities.players[0] = { ...identities.players[0], sleeperId: undefined }; }, /unique real canonical/],
  ['a ranking with an unknown identity', (_identities, snapshot) => { snapshot.rankings[0] = { ...snapshot.rankings[0], fantasyProsId: 'unknown' }; }, /duplicate or unknown/],
  ['a duplicate ranking', (_identities, snapshot) => { snapshot.rankings[1] = { ...snapshot.rankings[0] }; }, /duplicate or unknown/],
])('rejects a catalog fixture with %s', async (_label, mutate, message) => {
  const [snapshot, identities, predictions] = await Promise.all(['fantasypros-snapshot', 'player-identity', 'predictions'].map(async name => JSON.parse(await readFile(new URL(`../demo-data/${name}.json`, import.meta.url), 'utf8'))));
  mutate(identities, snapshot);
  expect(() => buildCatalogFixture(snapshot, identities, predictions)).toThrow(message);
});

test('appends unranked identities from position rank 1 with zero points when no prediction exists', async () => {
  const [snapshot, identities, predictions] = await Promise.all(['fantasypros-snapshot', 'player-identity', 'predictions'].map(async name => JSON.parse(await readFile(new URL(`../demo-data/${name}.json`, import.meta.url), 'utf8'))));
  const kickers = new Set(identities.players.filter(player => player.position === 'K').map(player => player.fantasyProsId));
  snapshot.rankings = snapshot.rankings.filter(row => !kickers.has(row.fantasyProsId));
  snapshot.projections = snapshot.projections.filter(row => !kickers.has(row.fantasyProsId));
  const kicker = identities.players.find(player => player.position === 'K');
  predictions.players = predictions.players.filter(row => row.playerId !== kicker.canonicalId);
  const { snapshot: fixture } = buildCatalogFixture(snapshot, identities, predictions);
  expect(fixture.rankings.filter(row => row.position === 'K')[0]).toMatchObject({ fantasyProsId: kicker.fantasyProsId, positionalRank: 1 });
  expect(fixture.projections.find(row => row.fantasyProsId === kicker.fantasyProsId)?.projectedPoints).toBe(0);
});

test('serves decoded readiness fixtures built from the demo catalog', async () => {
  const data = await Promise.all(['fantasypros-snapshot', 'player-identity', 'predictions', 'sleeper-adp'].map(async name => JSON.parse(await readFile(new URL(`../demo-data/${name}.json`, import.meta.url), 'utf8'))));
  const { snapshot, catalog } = buildCatalogFixture(...data.slice(0, 3));
  expect(catalog.length).toBe(snapshot.rankings.length);
  const ready = buildReadinessFixture({ snapshot, identities: data[1], sleeper: data[3], catalog });
  const dist = await mkdtemp(path.join(tmpdir(), 'ui-ready-http-'));
  await writeFile(path.join(dist, 'index.html'), '<main>ordinary production app</main>');
  const server = createServer(createStaticHandler({ dist, fixture: (request, response, next) => {
    const value = ready.files[new URL(request.url, 'http://fixture.local').pathname];
    if (value === undefined) { next(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(value));
  } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    expect(Object.keys(await verifyFixtureHttp(`http://127.0.0.1:${server.address().port}`, ready.files))).toHaveLength(7);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
