import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { deriveDraft, type DerivedDraft } from '@fantasy-draft/shared/draft';
import { createShadowMock, shadowMockFormat } from '../src/stores/draft/derive-shadow-fixture';

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
  calls += 1;
}

const cases = [0, 69, 139, 140].map(completed => {
  const source = createShadowMock(completed);
  const original = JSON.stringify(source);
  const expected = deriveDraft(source, shadowMockFormat);
  assert.equal(expected.draftedPlayerIds.size, completed + [1, 70, 140].filter(pick => pick > completed).length);
  assert.equal(expected.teamRosters.flatMap(roster => Object.values(roster).flat()).length, expected.draftedPlayerIds.size);
  assert.deepEqual(expected.myRoster, expected.teamRosters[4]);
  assert.equal(expected.currentPick, completed >= 139 ? 141 : completed === 69 ? 71 : 2);
  for (let index = 0; index < warmups; index += 1) consume(deriveDraft(source, shadowMockFormat));
  const samples = [];
  for (let batch = 0; batch < batches; batch += 1) {
    let last = expected;
    const start = performance.now();
    for (let index = 0; index < batchSize; index += 1) {
      last = deriveDraft(source, shadowMockFormat);
      consume(last);
    }
    samples.push((performance.now() - start) / batchSize);
    assert.deepEqual(last, expected);
  }
  assert.equal(JSON.stringify(source), original);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    completed, historyEntries: source.history.length, keeperPicks: [1, 70, 140],
    samplesMs: samples, medianMs: sorted[3], minMs: sorted[0], maxMs: sorted[6],
    currentPick: expected.currentPick, unavailablePlayers: expected.draftedPlayerIds.size,
  };
});
assert.equal(calls, cases.length * (warmups + batches * batchSize));
assert.ok(checksum > 0);
console.log(JSON.stringify({
  node: process.version, mode: process.env.NODE_ENV, cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, loadavg: loadavg(), batches, batchSize, warmups,
  cases, consumedCalls: calls, checksum, failures: 0,
}, null, 2));
