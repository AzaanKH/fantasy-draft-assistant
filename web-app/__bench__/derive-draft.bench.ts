import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { POSITIONS, createEmptyRoster } from '@fantasy-draft/shared/league';
import { createSlotSequence, deriveDraft, type DerivedDraft } from '@fantasy-draft/shared/draft';
import { createDraftMockStore, draftMockFormat } from '../src/stores/draft/draft-fixture';

import { draftPlayers } from '../src/stores/draft/draft-catalog';
import { draftSource } from '../src/stores/draft/source';

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

function expectedRosters(completed: number): ReturnType<typeof createEmptyRoster>[] {
  const order = createSlotSequence(draftMockFormat);
  const rosters = Array.from({ length: 10 }, createEmptyRoster);
  for (const pick of [1, 70, 140]) {
    const roster = rosters[order.at(pick).teamIndex];
    assert.ok(roster);
    rosters[order.at(pick).teamIndex] = { ...roster, RB: [...roster.RB, `keeper-${pick}`] };
  }
  for (const slot of order.slots.slice(0, completed)) {
    if ([1, 70, 140].includes(slot.pick)) continue;
    const position = POSITIONS[(slot.pick - 1) % POSITIONS.length] ?? 'WR';
    const roster = rosters[slot.teamIndex];
    assert.ok(roster);
    rosters[slot.teamIndex] = { ...roster, [position]: [...roster[position], `player-${slot.pick}`] };
  }
  return rosters;
}

const stages = [
  { completed: 0, provider: false }, { completed: 69, provider: false },
  { completed: 139, provider: false }, { completed: 140, provider: false },
  { completed: 139, provider: true },
];
const cases = stages.map(({ completed, provider }) => {
  const store = createDraftMockStore(completed);
  if (provider) store.getState().reconcileSyncedPicks(store.getState().draftHistory.map(pick => ({
    ...pick, isMyPick: pick.teamIndex === 4,
  })), completed + 1);
  const source = draftSource(store.getState());
  const original = JSON.stringify(source);
  const expected = deriveDraft(source, draftMockFormat, draftPlayers);
  assert.equal(expected.draftedPlayerIds.size, completed + [1, 70, 140].filter(pick => pick > completed).length);
  assert.equal(expected.teamRosters.flatMap(roster => Object.values(roster).flat()).length, expected.draftedPlayerIds.size);
  assert.deepEqual(expected.myRoster, expected.teamRosters[4]);
  assert.equal(expected.currentPick, provider || completed === 140 ? 141 : completed + 1);
  assert.deepEqual(expected.teamRosters, expectedRosters(completed));
  assert.equal(expected.available.length, draftPlayers.length - source.history.filter(pick => pick.playerId.startsWith('player-')).length);
  for (let index = 0; index < warmups; index += 1) consume(deriveDraft(source, draftMockFormat, draftPlayers));
  const samples = [];
  for (let batch = 0; batch < batches; batch += 1) {
    let last = expected;
    const start = performance.now();
    for (let index = 0; index < batchSize; index += 1) {
      last = deriveDraft(source, draftMockFormat, draftPlayers);
      consume(last);
    }
    samples.push((performance.now() - start) / batchSize);
    assert.deepEqual(last, expected);
  }
  assert.equal(JSON.stringify(source), original);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    completed, provider, catalogPlayers: draftPlayers.length, availablePlayers: expected.available.length, historyEntries: source.history.length, keeperPicks: [1, 70, 140],
    samplesMs: samples, medianMs: sorted[3], minMs: sorted[0], maxMs: sorted[6],
    currentPick: expected.currentPick, unavailablePlayers: expected.draftedPlayerIds.size,
  };
});

// Alternate provider progress so every timed reconciliation changes the accepted cursor.
const providerStore = createDraftMockStore(139);
const providerPicks = providerStore.getState().draftHistory.map(pick => ({ ...pick, isMyPick: pick.teamIndex === 4 }));
let reconciliationCalls = 0;
function reconcileAndDerive(): DerivedDraft {
  const next = reconciliationCalls++ % 2 === 0 ? 139 : 140;
  const result = providerStore.getState().reconcileSyncedPicks(providerPicks, next);
  assert.equal(result.changed, true);
  return deriveDraft(draftSource(providerStore.getState()), draftMockFormat, draftPlayers);
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
  assert.equal(last?.currentPick, reconciliationCalls % 2 === 1 ? 139 : 141);
  assert.deepEqual(last?.teamRosters, expectedRosters(139));
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
