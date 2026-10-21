import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { deriveDraft, type DerivedDraft } from '@fantasy-draft/shared/draft';
import { createShadowMockStore, shadowMockFormat } from '../src/stores/draft/derive-shadow-fixture';

import { shadowPlayers } from '../src/stores/draft/derive-shadow-catalog';
import { shadowSource } from '../src/stores/draft/derive-shadow-source';

const batchSize = 2000;
const batches = 7;
const warmups = 1000;
let checksum = 0;
let calls = 0;
function consume(view: DerivedDraft): void {
  checksum += view.currentPick + view.draftedPlayerIds.size + view.shortlistedPlayerIds.length + Number(view.isMyTurn);
  for (const roster of [...view.teamRosters, view.myRoster]) {
    for (const ids of Object.values(roster)) checksum += ids.length;
  }
  checksum += Number(view.canDraft) + Number(view.canRecord);
  for (const allowed of Object.values(view.canDraftByPosition)) checksum += Number(allowed);
  for (const player of view.available) checksum += player.id.length + player.name.length + player.ecrRank;
  calls += 1;
}

const stages = [
  { completed: 0, provider: false }, { completed: 69, provider: false },
  { completed: 139, provider: false }, { completed: 140, provider: false },
  { completed: 139, provider: true },
];
const cases = stages.map(({ completed, provider }) => {
  const store = createShadowMockStore(completed);
  if (provider) store.getState().reconcileSyncedPicks(store.getState().draftHistory.map(pick => ({
    ...pick, isMyPick: pick.teamIndex === 4,
  })), completed + 1);
  const source = shadowSource(store.getState());
  const original = JSON.stringify(source);
  const expected = deriveDraft(source, shadowMockFormat, shadowPlayers);
  assert.equal(expected.draftedPlayerIds.size, completed + [1, 70, 140].filter(pick => pick > completed).length);
  assert.equal(expected.teamRosters.flatMap(roster => Object.values(roster).flat()).length, expected.draftedPlayerIds.size);
  assert.deepEqual(expected.myRoster, expected.teamRosters[4]);
  assert.equal(expected.currentPick, provider || completed === 140 ? 141 : completed + 1);
  assert.equal(expected.currentPick, store.getState().currentPick);
  assert.deepEqual(expected.teamRosters, store.getState().teamRosters);
  assert.equal(expected.available.length, shadowPlayers.length - source.history.filter(pick => pick.playerId.startsWith('player-')).length);
  for (let index = 0; index < warmups; index += 1) consume(deriveDraft(source, shadowMockFormat, shadowPlayers));
  const samples = [];
  for (let batch = 0; batch < batches; batch += 1) {
    let last = expected;
    const start = performance.now();
    for (let index = 0; index < batchSize; index += 1) {
      last = deriveDraft(source, shadowMockFormat, shadowPlayers);
      consume(last);
    }
    samples.push((performance.now() - start) / batchSize);
    assert.deepEqual(last, expected);
  }
  assert.equal(JSON.stringify(source), original);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    completed, provider, catalogPlayers: shadowPlayers.length, availablePlayers: expected.available.length, historyEntries: source.history.length, keeperPicks: [1, 70, 140],
    samplesMs: samples, medianMs: sorted[3], minMs: sorted[0], maxMs: sorted[6],
    currentPick: expected.currentPick, unavailablePlayers: expected.draftedPlayerIds.size,
  };
});

// Alternate provider progress so every timed reconciliation changes the accepted cursor.
const providerStore = createShadowMockStore(139);
const providerPicks = providerStore.getState().draftHistory.map(pick => ({ ...pick, isMyPick: pick.teamIndex === 4 }));
let reconciliationCalls = 0;
function reconcileAndDerive(): DerivedDraft {
  const next = reconciliationCalls++ % 2 === 0 ? 139 : 140;
  const result = providerStore.getState().reconcileSyncedPicks(providerPicks, next);
  assert.equal(result.changed, true);
  return deriveDraft(shadowSource(providerStore.getState()), shadowMockFormat, shadowPlayers);
}
for (let index = 0; index < warmups; index += 1) consume(reconcileAndDerive());
const reconciliationSamples = [];
for (let batch = 0; batch < batches; batch += 1) {
  const start = performance.now();
  let last: DerivedDraft | undefined;
  for (let index = 0; index < batchSize; index += 1) {
    last = reconcileAndDerive();
    consume(last);
  }
  reconciliationSamples.push((performance.now() - start) / batchSize);
  assert.equal(last?.currentPick, providerStore.getState().currentPick);
  assert.deepEqual(last?.teamRosters, providerStore.getState().teamRosters);
}
const reconciliationSorted = [...reconciliationSamples].sort((a, b) => a - b);
assert.equal(reconciliationCalls, warmups + batches * batchSize);
assert.equal(calls, (cases.length + 1) * (warmups + batches * batchSize));
assert.ok(checksum > 0);
console.log(JSON.stringify({
  node: process.version, mode: process.env.NODE_ENV, cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, loadavg: loadavg(), batches, batchSize, warmups,
  reconciliationAndDerive: { samplesMs: reconciliationSamples, medianMs: reconciliationSorted[3],
    minMs: reconciliationSorted[0], maxMs: reconciliationSorted[6], changedReconciliations: reconciliationCalls },
  cases, consumedCalls: calls, checksum, failures: 0,
}, null, 2));
