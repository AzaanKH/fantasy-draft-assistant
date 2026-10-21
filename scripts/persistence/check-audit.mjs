import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit, auditConflict, summarize, failsGate } from './audit.mjs';

const a = { cmd: { id: 'a', type: 'pick', slot: 1, player: 'alice' }, receipt: { accepted: true } };
const b = { cmd: { id: 'b', type: 'shortlistAdd', player: 'bob' }, receipt: { accepted: true } };
const snapshot = (picks = [], shortlist = []) => ({ picks, shortlist, errors: [] });
const pick = { pickNumber: 1, playerId: 'alice' };

test('counts acknowledged effects after reload and excludes rejected commands', () => {
  const rejected = { ...b, receipt: { accepted: false } };
  const result = audit([a, rejected], [snapshot([pick]), snapshot([pick])]);
  assert.equal(result.commands, 2);
  assert.equal(result.acknowledged, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.kept, 1);
  assert.equal(result.lost, 0);
});

test('separates partition divergence from effects absent from both stores', () => {
  const result = audit([a, b], [snapshot([pick]), snapshot([], ['bob'])]);
  assert.deepEqual(result.missing, [['b'], ['a']]);
  assert.deepEqual(result.unionMissing, []);
  assert.equal(result.converged, false);
  assert.deepEqual(result.keptByTarget, [1, 1]);
});

test('detects shared losses, duplicate picks, and exact aggregate totals', () => {
  const checks = audit([a, b], [snapshot([pick, pick]), snapshot([pick])]);
  assert.deepEqual(checks.unionMissing, ['b']);
  assert.equal(checks.unique, false);
  const [summary] = summarize([{ label: 'tabs', runs: [{ checks }, { checks }] }]);
  assert.equal(summary.commands, 4);
  assert.equal(summary.kept, 2);
  assert.equal(summary.lost, 2);
  assert.equal(summary.absentFromBoth, 2);
  assert.equal(summary.invariantFailures, 2);
});


test('retains storage errors observed before reload', () => {
  const before = { ...snapshot([pick]), errors: [{ error: 'QuotaExceededError' }] };
  assert.equal(audit([a], [snapshot([pick]), snapshot([pick])], [before]).errors, 1);
});

test('rejects double acceptance of a conflicting pick and accepts one durable winner', () => {
  const rival = { cmd: { id: 'rival', type: 'pick', slot: 1, player: 'rival' }, receipt: { accepted: true } };
  const states = [snapshot([pick]), snapshot([pick])];
  assert.equal(auditConflict('pick', [a, rival], states).good, false);
  assert.equal(auditConflict('pick', [a, { ...rival, receipt: { accepted: false } }], states).good, true);
  const bad = auditConflict('pick', [a, rival], states);
  const [summary] = summarize([{ label: 'tabs', runs: [], conflicts: [{ kind: 'pick', checks: bad }],
    sequentialControl: { checks: audit([a], [snapshot(), snapshot()]) } }]);
  assert.equal(summary.sequentialFailures, 1);
  assert.equal(summary.conflictFailures, 1);
  assert.equal(summary.conflictLostPicks, 1);
});

test('requires exact queue order and preserves the queue permutation for moves', () => {
  const cmd = { cmd: { type: 'shortlistMove', player: 'p1', toIndex: 0 }, receipt: { accepted: true } };
  const left = snapshot([], ['p1', 'p0', 'p2', 'p3']);
  const right = snapshot([], ['p0', 'p2', 'p3', 'p1']);
  assert.equal(auditConflict('move', [cmd], [left, left]).good, true);
  assert.equal(auditConflict('move', [cmd], [left, right]).good, false);
});


test('gates controls and conflicts even when stress itself has no loss', () => {
  const clean = { scenario: 'tabs', lost: 0, acknowledged: 1 };
  assert.equal(failsGate({ pageErrors: [], summary: [clean] }), false);
  assert.equal(failsGate({ pageErrors: [], summary: [{ ...clean, conflictFailures: 1 }] }), true);
  assert.equal(failsGate({ pageErrors: [], summary: [{ ...clean, sequentialFailures: 1 }] }), true);
  assert.equal(failsGate({ pageErrors: [], summary: [{ ...clean, scenario: 'extension-no-permission' }] }), true);
});
