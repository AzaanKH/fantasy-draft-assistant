import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCatalogFixture, selectCatalog, planSession, assertPlan, auditSession, sessionPasses,
  auditPickConflict, auditMoveConflict, auditReconcileBurst, evaluateUiGate, evaluateTier2 } from './persistence/ui-adapter.mjs';
const root = new URL('..', import.meta.url).pathname;
const [original, identities, predictions] = await Promise.all(['fantasypros-snapshot', 'player-identity', 'predictions'].map(async name => JSON.parse(await readFile(`${root}/demo-data/${name}.json`, 'utf8'))));
test('real catalog fixture preserves inputs and resolves 900 unique canonical/Sleeper identities', () => {
  const before = JSON.stringify(original);
  const fixture = buildCatalogFixture(original, identities, predictions);
  assert.equal(JSON.stringify(original), before);
  assert.equal(fixture.catalog.length, 900);
  assert.equal(new Set(fixture.catalog.map(p => p.id)).size, 900);
  assert.equal(new Set(fixture.catalog.map(p => p.sleeperId)).size, 900);
  assert.deepEqual(fixture.snapshot.rankings.slice(0, original.rankings.length), original.rankings);
  assert.deepEqual(assertPlan(planSession(selectCatalog(fixture.catalog, 600))), []);
});
test('duplicate or unknown fixture identities fail before launch', () => {
  assert.throws(() => buildCatalogFixture(original, { players: [...identities.players, identities.players[0]] }, predictions), /unique/);
  const input = structuredClone(original); input.rankings[0].fantasyProsId = 'unknown';
  assert.throws(() => buildCatalogFixture(input, identities, predictions), /unknown/);
});
const picked = { pickNumber: 1, playerId: 'p1', source: 'provisional' };
const committed = { present: true, picks: [picked], queue: ['q1'] };
const issued = [{ cmd: { id: 'pick', type: 'pick', slot: 1, playerId: 'p1' }, outcome: 'ack' }, { cmd: { id: 'queue', type: 'queueAdd', playerId: 'q1' }, outcome: 'ack' }];
const evidence = () => ({ issued, committed, committedBefore: committed, queueDom: { before: [['q1'], ['q1']], after: [['q1'], ['q1']] }, pickDom: { before: [[picked], [picked]], after: [[picked], [picked]] } });
test('session proof requires both rendered actors and committed facts before and after reload', () => {
  assert.equal(sessionPasses(auditSession(evidence()), 2), true);
  for (const phase of ['before', 'after']) {
    const missing = evidence(); missing.pickDom = structuredClone(missing.pickDom); missing.pickDom[phase][1] = [];
    assert.equal(sessionPasses(auditSession(missing), 2), false);
    const absent = evidence(); absent.queueDom = structuredClone(absent.queueDom); absent.queueDom[phase] = [];
    assert.equal(sessionPasses(auditSession(absent), 2), false);
  }
  const normalized = evidence(); normalized.committedBefore = { ...committed, picks: [picked, picked] };
  assert.equal(sessionPasses(auditSession(normalized), 2), false);
});
test('queue order and acknowledgements cannot hide lost or unexpected facts', () => {
  const changed = evidence(); changed.committed = { ...committed, queue: ['q2'] };
  assert.equal(sessionPasses(auditSession(changed), 2), false);
  const rejected = evidence(); rejected.issued = [{ ...issued[0], outcome: 'rejected' }, issued[1]];
  assert.equal(sessionPasses(auditSession(rejected), 2), false);
});
test('conflict proof requires one accepted winner and an explicit rejected loser', () => {
  const args = { results: [{ cmd: { playerId: 'p1' }, outcome: 'ack' }, { cmd: { playerId: 'p2' }, outcome: 'rejected', alert: 'slot occupied' }], committed: { picks: [picked] }, slot: 1, players: ['p1', 'p2'] };
  assert.equal(auditPickConflict(args).good, true);
  args.results[1].outcome = 'ack'; assert.equal(auditPickConflict(args).good, false);
});
test('two opposite moves cannot pass as two dropped or unacknowledged operations', () => {
  const original = ['a', 'b', 'c', 'd'];
  const args = { original, orders: [original, original], committedAfterReload: original, renderedAfterReload: [original, original], receipts: [{ outcome: 'ack' }, { outcome: 'ack' }], revisionBefore: 4, revisionAfter: 6 };
  assert.equal(auditMoveConflict(args).good, true);
  assert.equal(auditMoveConflict({ ...args, revisionAfter: 4 }).good, false);
  assert.equal(auditMoveConflict({ ...args, receipts: [] }).good, false);
  assert.equal(auditMoveConflict({ ...args, committedAfterReload: ['b', 'a', 'c', 'd'] }).good, false);
});
test('reconciliation requires every exact provider fact, retained acknowledged picks and no command errors', () => {
  const provider = [{ ...picked, source: 'sleeper-api' }];
  const args = { issued: [issued[0]], committed: { picks: provider }, provider, flippedAt: 1 };
  assert.equal(auditReconcileBurst(args).good, true);
  assert.equal(auditReconcileBurst({ ...args, provider: [...provider, { pickNumber: 2, playerId: 'missing' }] }).good, false);
  assert.equal(auditReconcileBurst({ ...args, issued: [...issued.slice(0, 1), { outcome: 'error' }] }).good, false);
});
test('gates reject absent/malformed raw evidence instead of trusting stored checks', () => {
  assert.equal(evaluateUiGate({}).passes, false);
  assert.equal(evaluateTier2({}).passes, false);
  const fake = { metadata: { finished: 'yes', sourceStable: true, suites: 1, seeds: 1, commandsPerActor: 300 }, pageErrors: [], scenarioErrors: [], cleanupErrors: [], scenarios: [{ label: 'tabs', checks: { good: true } }], commandStarts: [], commandLog: [] };
  assert.equal(evaluateTier2(fake).passes, false);
});
function passingEvidence(full = false) {
  const catalog = selectCatalog(buildCatalogFixture(original, identities, predictions).catalog, 600);
  const plan = planSession(catalog);
  const rows = plan.actors.flat().map(cmd => ({ cmd, outcome: 'ack' }));
  const picks = plan.picks.map(cmd => ({ pickNumber: cmd.slot, playerId: cmd.playerId, source: 'provisional' }));
  const queue = plan.queue.map(cmd => cmd.playerId);
  const head = { present: true, picks, queue };
  const run = { issued: rows, committed: head, committedBefore: head, queueDom: { before: [queue, queue], after: [queue, queue] }, pickDom: { before: [picks, picks], after: [picks, picks] }, notSavedVisible: [false, false] };
  const conflict = { results: [{ cmd: { playerId: 'p1' }, outcome: 'ack' }, { cmd: { playerId: 'p2' }, outcome: 'rejected', alert: 'occupied' }], committed: { picks: [picked] }, slot: 1, players: ['p1', 'p2'] };
  const originalOrder = ['a', 'b', 'c', 'd'];
  const move = { original: originalOrder, orders: [originalOrder, originalOrder], committedAfterReload: originalOrder, renderedAfterReload: [originalOrder, originalOrder], receipts: [{ outcome: 'ack' }, { outcome: 'ack' }], revisionBefore: 4, revisionAfter: 6 };
  const provider = [{ ...picked, source: 'sleeper-api' }];
  const reconcile = { issued: [issued[0]], committed: { picks: provider }, provider, flippedAt: 1 };
  const activation = { completed: true, readOnlyBeforeConfirm: true, secondTabNoPrompt: true, v1RetainedByteIdentical: true, buttonDisabledBeforeCheckbox: true, tombstoneBefore: false, tombstoneAfter: true, importedAll: true };
  const positive = label => ({ label, activation, runs: Array.from({ length: full ? 15 : 1 }, (_, i) => ({ ...run, suite: Math.floor(i / 5) + 1, seed: i % 5 + 1 })), control: run,
    pickConflicts: Array.from({ length: 20 }, (_, i) => ({ ...conflict, sample: i + 1 })), moveConflicts: Array.from({ length: full ? 100 : 20 }, (_, i) => ({ ...move, sample: i + 1 })),
    bursts: { reconcile, mock: { steps: Array.from({ length: 4 }, (_, i) => ({ drafted: `user${i}`, receipt: { cmd: { id: `mock${i}` }, outcome: 'ack' } })), board: ['Pick 1.1, user0, My Team', 'Pick 2.1, user1, My Team', 'Pick 3.1, user2, My Team', 'Pick 4.1, user3, My Team', 'Pick 1.2, CPU, latest pick'], notSaved: false, v1Before: [], v1After: [] } }, v1AtActivation: [], v1FinalSnapshot: [],
    panel: { openedLocalWorkspace: true, reloadRecovered: true, actorWrites: full ? 4500 : 300 } });
  const negative = label => ({ label, blocked: { before: { v1: [], databases: [] }, after: { v1: [], databases: [], errorText: 'permission required', draftRoomAbsent: true } } });
  const result = { metadata: { finished: 'done', sourceStable: true, sourceHashes: { source: 'hash' }, sourceHashesEnd: { source: 'hash' },
    suites: full ? 3 : 1, seeds: full ? 5 : 1, commandsPerActor: 300, git: { head: 'abc', clean: true }, gitEnd: { head: 'abc', status: '' }, expectedHead: 'abc',
    catalogFixture: { schemaDecoded: true, identityCount: 900 }, env: { VITE_STORAGE_ACTIVATION: 'idb' } },
    pageErrors: [], scenarioErrors: [], cleanupErrors: [], commandStarts: [{ actionId: 'sample' }], commandLog: [{ actionId: 'sample' }],
    scenarios: [positive('tabs'), positive('extension-granted'), negative('extension-no-permission'), negative('hostname-split')] };
  if (full) {
    const hash = 'a'.repeat(64);
    const files = { 'index.html': hash, 'assets/app.js': hash };
    const env = { MODE: 'production', DEV: false, PROD: true, VITE_STORAGE_ACTIVATION: 'idb' };
    Object.assign(result.metadata, { serve: 'production-static', resolvedEnv: env,
      productionBuild: { env, files, noViteClientOrHmr: true },
      productionHttp: { verified: files, rejected: { '/@vite/client': 404, '/@react-refresh': 404, '/src/main.tsx': 404, '/node_modules/vite/dist/client/client.mjs': 404 }, catalogFixtureSha256: hash },
      sourceHashes: { 'web-app/dist/index.html': hash, 'web-app/dist/assets/app.js': hash },
      sourceHashesEnd: { 'web-app/dist/index.html': hash, 'web-app/dist/assets/app.js': hash },
    });
    result.metadata.catalogFixture.sha256 = hash;
  }
  const independent = JSON.parse(JSON.stringify(result));
  independent.commandStarts = []; independent.commandLog = [];
  let counter = 0;
  for (const scenario of independent.scenarios) {
    const observed = [...(scenario.runs ?? []).flatMap(run => run.issued), ...(scenario.control?.issued ?? []),
      ...(scenario.pickConflicts ?? []).flatMap(row => row.results), ...(scenario.moveConflicts ?? []).flatMap(row => row.receipts),
      ...(scenario.bursts?.reconcile?.issued ?? []), ...(scenario.bursts?.mock?.steps ?? []).map(step => step.receipt)];
    for (const row of observed) { row.actionId = `action${counter++}`; independent.commandStarts.push({ actionId: row.actionId, cmd: row.cmd }); independent.commandLog.push(structuredClone(row)); }
  }
  return independent;
}
test('Tier 2 accepts complete raw proof and recomputes a failed session despite cached success', () => {
  const result = passingEvidence();
  assert.equal(evaluateTier2(result).passes, true, JSON.stringify(evaluateTier2(result)));
  result.scenarios[0].runs[0].checks = { good: true };
  result.scenarios[0].runs[0].committed = { present: true, picks: [], queue: [] };
  assert.equal(evaluateTier2(result).passes, false);
});
test('final gate accepts complete proof with native visibility still separately open', () => {
  const result = passingEvidence(true);
  assert.equal(evaluateUiGate(result).passes, true, JSON.stringify(evaluateUiGate(result)));
  assert.equal(evaluateUiGate(result).open.length, 1);
  result.scenarios[0].runs[0].seed = 2;
  assert.equal(evaluateUiGate(result).passes, false);
});
test('missing receipts, changed sources, dropped moves and absent final v1 snapshot fail the Tier 2 score', () => {
  for (const mutate of [r => r.commandLog.pop(), r => r.metadata.sourceHashesEnd.source = 'changed',
    r => r.scenarios[1].moveConflicts[0] = { ...r.scenarios[1].moveConflicts[0], revisionAfter: 4 }, r => delete r.scenarios[0].v1FinalSnapshot]) {
    const result = passingEvidence(); mutate(result); assert.equal(evaluateTier2(result).passes, false);
  }
});

test('raw workload rows must each have their own matching command receipt', () => { const r = passingEvidence(); r.commandStarts = [{ actionId: 'unrelated' }]; r.commandLog = [{ actionId: 'unrelated' }]; assert.equal(evaluateTier2(r).passes, false); });


test('the final gate rejects dev serving, absent production provenance, HMR routes and changed served bytes', () => {
  for (const mutate of [
    r => r.metadata.serve = 'vite-dev',
    r => delete r.metadata.productionBuild,
    r => r.metadata.resolvedEnv.DEV = true,
    r => r.metadata.productionHttp.rejected['/@vite/client'] = 200,
    r => r.metadata.productionHttp.verified['assets/app.js'] = 'b'.repeat(64),
    r => r.metadata.productionHttp.catalogFixtureSha256 = 'b'.repeat(64),
  ]) { const result = passingEvidence(true); mutate(result); assert.equal(evaluateUiGate(result).passes, false); }
});

test('an unprompted production navigation fails otherwise complete matrix evidence', () => {
  const result = passingEvidence(true);
  result.productionNavigationDefect = { message: 'STOP product defect: unprompted production document navigation' };
  assert.equal(evaluateUiGate(result).passes, false);
});
