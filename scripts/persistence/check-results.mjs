import { checkIdbGate } from './idb-gate.mjs';
import { auditBlocked } from './blocked-adapter.mjs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { audit, auditConflict, summarize, failsGate } from './audit.mjs';
import { auditConflict11b, check11bBands } from './bands-11b.mjs';

const results = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.ok(results.metadata.finished, 'Run did not finish');
assert.equal(results.fatal, undefined, 'Run failed');
assert.deepEqual(results.scenarioErrors, [], 'One or more scenarios did not complete');
for (const scenario of results.scenarios) {
  if (results.metadata.store === 'idb' && ['extension-no-permission', 'hostname-split'].includes(scenario.label)) {
    assert.ok(scenario.blocked, 'Missing explicit blocked-workspace evidence');
    assert.deepEqual(scenario.blocked.checks, auditBlocked(scenario.blocked.issued, scenario.blocked.before, scenario.blocked.after));
    assert.equal(scenario.blocked.checks.acknowledged, 0);
    assert.equal(scenario.blocked.checks.rejected, results.metadata.commandsPerActor);
    assert.equal(scenario.blocked.checks.explicitSetupError, true);
    assert.equal(scenario.blocked.checks.unchanged, true);
    continue;
  }
  assert.equal(scenario.runs.length, results.metadata.suites * results.metadata.seeds);
  for (const run of scenario.runs) {
    assert.equal(run.issued.length, 2 * results.metadata.commandsPerActor);
    assert.deepEqual(run.checks, audit(run.issued, run.afterReload, run.beforeReload));
    for (let i = 0; i < run.afterReload.length; i++) {
      const state = run.afterReload[i];
      const head = run.afterStored[i].head;
      assert.deepEqual(state.picks, head.draftHistory, 'Reloaded state differs from stored history');
      assert.deepEqual(state.shortlist, head.shortlistedPlayerIds, 'Reloaded queue differs from stored queue');
    }
    for (const snapshot of [...run.beforeReload, ...run.afterReload]) {
      assert.equal(snapshot.identity.draftId, run.capabilities[0].initial.identity.draftId);
      assert.equal(snapshot.mode, 'live');
    }
  }
  assert.deepEqual(scenario.sequentialControl.checks, audit(scenario.sequentialControl.issued,
    scenario.sequentialControl.afterReload, scenario.sequentialControl.beforeReload));
  for (const conflict of scenario.conflicts) {
    assert.deepEqual(conflict.checks, auditConflict(conflict.kind, conflict.issued, conflict.afterReload, conflict.settled));
    if (conflict.checks11b) assert.deepEqual(conflict.checks11b, auditConflict11b(conflict.kind, conflict.issued,
      conflict.afterReload, conflict.settled, ['tabs', 'extension-granted'].includes(scenario.label)));
  }
}
assert.deepEqual(results.summary, summarize(results.scenarios));
const bands11b = check11bBands(results);
if (results.bands11b) assert.deepEqual(results.bands11b, bands11b);
console.log(JSON.stringify({ summary: results.summary, passesFutureGate: !failsGate(results), bands11b }, null, 2));
if (process.argv.includes('--gate') && failsGate(results)) process.exitCode = 1;

if (process.argv.includes('--gate-11b') && !bands11b.passes) process.exitCode = 1;

if (results.idbGate) assert.deepEqual(results.idbGate, checkIdbGate(results));
if (process.argv.includes('--gate-idb') && !checkIdbGate(results).passes) process.exitCode = 1;
