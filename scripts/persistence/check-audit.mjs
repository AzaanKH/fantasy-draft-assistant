import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readReloadBoundary } from './reload-boundary.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { audit, auditConflict, summarize, failsGate } from './audit.mjs';
import { auditConflict11b, check11bBands } from './bands-11b.mjs';

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

function evidence(issued, states) {
  const stored = states.map(state => {
    const head = { identity: state.identity, draftHistory: state.picks, shortlistedPlayerIds: state.shortlist };
    return { head, rawHead: JSON.stringify(head), journals: [] };
  });
  return { issued, capabilities: states.map(state => ({ initial: { identity: state.identity } })),
    beforeReload: states, afterReload: states, settled: states, stored, afterStored: stored };
}

function matrix11b({ tabsLost = 3893, extensionLost = 3589, tabsWorst, extensionWorst } = {}) {
  const commands = Array.from({ length: 600 }, (_, i) => {
    const actor = Math.floor(i / 300);
    const index = i % 300;
    const player = `${actor}:${index}`;
    return { cmd: index % 2 === 0 ? { id: player, type: 'pick', slot: actor * 150 + index / 2 + 1, player }
      : { id: player, type: 'shortlistAdd', player }, receipt: { accepted: true } };
  });
  const identity = { provider: 'sleeper', draftId: 'test' };
  const stateFor = rows => ({ ...snapshot(rows.filter(row => row.cmd.type === 'pick').map(row => ({
    pickNumber: row.cmd.slot, playerId: row.cmd.player })),
  rows.filter(row => row.cmd.type === 'shortlistAdd').map(row => row.cmd.player)), identity, mode: 'live' });
  const statesFor = (shared, lost) => shared ? [stateFor(commands.slice(lost)), stateFor(commands.slice(lost))]
    : [stateFor(commands.slice(0, 300)), stateFor(commands.slice(300))];
  const scenarios = ['tabs', 'extension-granted', 'extension-no-permission', 'hostname-split'].map(label => {
    const shared = ['tabs', 'extension-granted'].includes(label);
    let remaining = label === 'tabs' ? tabsLost : extensionLost;
    const runs = Array.from({ length: 15 }, (_, i) => {
      const requestedWorst = label === 'tabs' ? tabsWorst : extensionWorst;
      const lost = i === 0 && requestedWorst !== undefined ? requestedWorst : Math.floor(remaining / (15 - i));
      remaining -= lost;
      return { suite: Math.floor(i / 5) + 1, seed: i % 5 + 1, ...evidence(commands, statesFor(shared, lost)) };
    });
    const conflicts = ['pick', 'move'].flatMap(kind => Array.from({ length: 20 }, (_, i) => {
      const issued = kind === 'pick' ? [a, { cmd: { id: 'rival', type: 'pick', slot: 1, player: 'rival' }, receipt: { accepted: true } }]
        : [0, 3].map(toIndex => ({ cmd: { type: 'shortlistMove', player: 'p1', toIndex }, receipt: { accepted: true } }));
      const states = kind === 'pick' ? [stateFor([issued[0]]), stateFor([issued[shared ? 0 : 1]])]
        : [snapshot([], ['p1', 'p0', 'p2', 'p3']), snapshot([], shared ? ['p1', 'p0', 'p2', 'p3'] : ['p0', 'p2', 'p3', 'p1'])]
          .map(state => ({ ...state, identity, mode: 'live' }));
      return { kind, sample: i + 1, ...evidence(issued, states) };
    }));
    return { label, peerMarker: shared ? 'tab' : null, runs, conflicts,
      sequentialControl: evidence(commands, statesFor(shared, 0)) };
  });
  return { metadata: { finished: 'test', suites: 3, seeds: 5, commandsPerActor: 300 },
    pageErrors: [], scenarioErrors: [], scenarios };
}

test('11b accepts characterized losses and double acceptance while the future conflict gate stays strict', () => {
  const results = matrix11b();
  const report = check11bBands(results);
  assert.deepEqual(report.failures, []);
  assert.equal(report.passes, true);
  const sample = results.scenarios[0].conflicts[0];
  assert.equal(auditConflict('pick', sample.issued, sample.afterReload, sample.settled).good, false);
  assert.equal(auditConflict11b('pick', sample.issued, sample.afterReload, sample.settled).good, true);
  const oneAccepted = [sample.issued[0], { ...sample.issued[1], receipt: { accepted: false } }];
  assert.equal(auditConflict11b('pick', oneAccepted, sample.afterReload, sample.settled).good, true);
});

test('11b includes both aggregate band edges and rejects one effect beyond either edge', () => {
  for (const lost of [3443, 4343]) assert.equal(check11bBands(matrix11b({ tabsLost: lost })).passes, true);
  for (const lost of [3442, 4344]) assert.match(check11bBands(matrix11b({ tabsLost: lost })).failures.join('\n'), /tabs: aggregate loss/);
  for (const lost of [3139, 4039]) assert.equal(check11bBands(matrix11b({ extensionLost: lost })).passes, true);
  for (const lost of [3138, 4040]) assert.match(check11bBands(matrix11b({ extensionLost: lost })).failures.join('\n'), /extension-granted: aggregate loss/);
});

test('11b includes worst plus 30 but rejects a worse individual run despite an unchanged aggregate', () => {
  assert.equal(check11bBands(matrix11b({ tabsWorst: 300 })).passes, true);
  const report = check11bBands(matrix11b({ tabsWorst: 301 }));
  assert.equal(report.comparisons[0].lost, 3893);
  assert.match(report.failures.join('\n'), /tabs: per-run loss/);
  assert.equal(check11bBands(matrix11b({ extensionWorst: 294 })).passes, true);
  assert.match(check11bBands(matrix11b({ extensionWorst: 295 })).failures.join('\n'), /extension-granted: per-run loss/);
});

test('11b rejects missing samples, partial schedules, page errors, and sequential losses', () => {
  const results = matrix11b();
  results.scenarios[0].conflicts.pop();
  results.scenarios[0].runs[0].seed = 2;
  results.scenarios[0].sequentialControl = results.scenarios[0].runs[0];
  results.pageErrors.push({ message: 'uncaught' });
  const report = check11bBands(results);
  assert.equal(report.passes, false);
  for (const failure of [/20 distinct move samples/, /suite\/seed schedule/, /retain 600\/600/, /page or scenario errors/]) {
    assert.match(report.failures.join('\n'), failure);
  }
  results.scenarios.pop();
  assert.match(check11bBands(results).failures.join('\n'), /all four scenarios/);
});

test('11b requires a retained acknowledged pick without duplicate players or slots', () => {
  const { issued, settled, afterReload } = matrix11b().scenarios[0].conflicts[0];
  assert.equal(auditConflict11b('pick', issued, [snapshot(), snapshot()], settled).good, false);
  const unacknowledged = [snapshot([{ pickNumber: 1, playerId: 'unknown' }]), snapshot([{ pickNumber: 1, playerId: 'unknown' }])];
  assert.equal(auditConflict11b('pick', issued, unacknowledged, settled).good, false);
  for (const duplicate of [{ pickNumber: 1, playerId: 'rival' }, { pickNumber: 2, playerId: 'alice' }]) {
    const state = snapshot([pick, duplicate]);
    assert.equal(auditConflict11b('pick', issued, [state, state], settled).good, false);
  }
  assert.equal(auditConflict11b('pick', issued.map(row => ({ ...row, receipt: { accepted: false } })), afterReload, settled).good, false);
});

test('11b requires exact common settled queue order and a valid permutation after reload', () => {
  const sample = matrix11b().scenarios[0].conflicts[20];
  const different = snapshot([], ['p0', 'p2', 'p3', 'p1']);
  assert.equal(auditConflict11b('move', sample.issued, [different, different], sample.settled).good, false);
  const duplicate = snapshot([], ['p1', 'p0', 'p2', 'p1']);
  assert.equal(auditConflict11b('move', sample.issued, [duplicate, duplicate], sample.settled).good, false);
});

test('11b requires each negative actor to retain its own partition and distinct stored sessions', () => {
  const results = matrix11b();
  const run = results.scenarios[2].runs[0];
  [run.afterReload[0], run.afterReload[1]] = [run.afterReload[1], run.afterReload[0]];
  assert.match(check11bBands(results).failures.join('\n'), /retains its own commands/);
  const clean = matrix11b();
  const negative = clean.scenarios[2];
  negative.peerMarker = 'tab';
  negative.sequentialControl = clean.scenarios[0].sequentialControl;
  const failures = check11bBands(clean).failures.join('\n');
  assert.match(failures, /storage-sharing marker/);
  assert.match(failures, /distinct stored sessions/);
  assert.match(failures, /separate partitions must retain 300 each/);
});

test('11b rejects storage errors and storage bytes that disagree with scored snapshots', () => {
  const results = matrix11b();
  results.scenarios[0].runs[0].afterStored[0].rawHead = '{}';
  results.scenarios[1].conflicts[0].settled[0].errors.push({ error: 'QuotaExceededError' });
  const failures = check11bBands(results).failures.join('\n');
  assert.match(failures, /original storage bytes/);
  assert.match(failures, /conflict invariant/);
});


test('result checker applies 11b independently of the future durability gate and verifies retained audits', async () => {
  const results = matrix11b();
  for (const scenario of results.scenarios) {
    for (const run of [...scenario.runs, scenario.sequentialControl]) {
      run.checks = audit(run.issued, run.afterReload, run.beforeReload);
    }
    for (const sample of scenario.conflicts) {
      sample.checks = auditConflict(sample.kind, sample.issued, sample.afterReload, sample.settled);
      sample.checks11b = auditConflict11b(sample.kind, sample.issued, sample.afterReload, sample.settled,
        ['tabs', 'extension-granted'].includes(scenario.label));
    }
  }
  results.summary = summarize(results.scenarios);
  results.bands11b = check11bBands(results);
  const directory = mkdtempSync(path.join(tmpdir(), 'persistence-audit-'));
  const file = path.join(directory, 'results.json');
  const check = flag => checkInWorker(file, flag);
  try {
    writeFileSync(file, JSON.stringify(results));
    const comparison = await check('--gate-11b');
    assert.equal(comparison.status, 0, comparison.stderr);
    const printed = JSON.parse(comparison.stdout);
    assert.equal(printed.bands11b.passes, true);
    assert.equal(printed.passesFutureGate, false);
    assert.equal((await check('--gate')).status, 1);
    results.scenarios[0].conflicts[0].checks11b.good = false;
    writeFileSync(file, JSON.stringify(results));
    assert.equal((await check('--gate-11b')).status, 1);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('11b rejects settled duplicate players and slots even when reload normalizes them', async () => {
  for (const family of ['stress', 'sequential', 'conflict']) for (const duplicateKind of ['player', 'slot']) {
    const results = matrix11b();
    const scenario = results.scenarios[0];
    const run = family === 'stress' ? scenario.runs[0] : family === 'sequential' ? scenario.sequentialControl : scenario.conflicts[0];
    const snapshotKey = family === 'conflict' ? 'settled' : 'beforeReload';
    run[snapshotKey] = structuredClone(run[snapshotKey]);
    for (const state of run[snapshotKey]) {
      const first = state.picks[0];
      state.picks.push({ ...first, ...(duplicateKind === 'player' ? { pickNumber: 400 } : { playerId: 'extra-player' }) });
    }
    run.stored = evidence(run.issued, run[snapshotKey]).stored;
    for (const current of results.scenarios) {
      for (const effect of [...current.runs, current.sequentialControl]) effect.checks = audit(effect.issued, effect.afterReload, effect.beforeReload);
      for (const sample of current.conflicts) {
        sample.checks = auditConflict(sample.kind, sample.issued, sample.afterReload, sample.settled);
        sample.checks11b = auditConflict11b(sample.kind, sample.issued, sample.afterReload, sample.settled,
          ['tabs', 'extension-granted'].includes(current.label));
      }
    }
    results.summary = summarize(results.scenarios);
    results.bands11b = check11bBands(results);
    assert.equal(results.bands11b.passes, false, `${family} ${duplicateKind} must fail`);
    const directory = mkdtempSync(path.join(tmpdir(), 'persistence-settled-duplicates-'));
    try {
      const file = path.join(directory, 'results.json');
      writeFileSync(file, JSON.stringify(results));
      const raw = await checkInWorker(file, '--gate-11b');
      assert.equal(raw.status, 1, `${family} ${duplicateKind}: ${raw.stdout} ${raw.stderr}`);
    } finally { rmSync(directory, { recursive: true }); }
  }
});

function checkInWorker(file, flag) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./check-results.mjs', import.meta.url), { argv: [file, flag], stdout: true, stderr: true });
    let stdout = '';
    let stderr = '';
    worker.stdout.on('data', chunk => { stdout += chunk; });
    worker.stderr.on('data', chunk => { stderr += chunk; });
    worker.on('error', error => { stderr += error.stack; });
    worker.on('exit', status => { resolve({ status, stdout, stderr }); });
  });
}

test('explicit reload reattaches only to a replacement document and rejects unstable or missing adapters', async () => {
  const state = snapshot([pick]);
  const stable = [{ kind: 'snapshot', snapshot: state }];
  let attachments = 0;
  const recorded = [];
  let reads = 0;
  assert.deepEqual(await readReloadBoundary({ read: async () => ++reads === 1 ? [{ kind: 'replaced', expected: 1, actual: 2 }] : stable,
    attach: async () => { attachments++; }, recordReplacement: rows => { recorded.push(rows); } }), [state]);
  assert.equal(attachments, 1);
  assert.deepEqual(recorded, [[{ kind: 'replaced', expected: 1, actual: 2 }]]);
  await assert.rejects(readReloadBoundary({ read: async () => [{ kind: 'replaced' }],
    attach: async () => { attachments++; }, recordReplacement: () => undefined }), /kept changing/);
  const before = attachments;
  await assert.rejects(readReloadBoundary({ read: async () => { throw new Error('adapter missing in same document'); },
    attach: async () => { attachments++; }, recordReplacement: () => undefined }), /adapter missing/);
  assert.equal(attachments, before);
});
