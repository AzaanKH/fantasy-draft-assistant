import { test, expect } from 'vitest';
import { rootSmokeEvidence } from './persistence/fixtures/root-smoke-evidence.mjs';
import { ROOT_SMOKE_SCOPE, ROOT_SMOKE_PLAN, evaluateRootSmoke, runRootSmokeSteps } from './persistence/ui-root-smoke.mjs';
import { validateSmokeAuthorization } from './persistence/root-smoke-driver.mjs';

test('the smoke driver rejects unpushed, dirty, reused or non-green head evidence before launch', () => {
  const head = '2'.repeat(40);
  const input = { args: ['--browser-authorized'], env: { UI_EXPECTED_HEAD: head, UI_OUTPUT: '/tmp/fresh-smoke', UI_CI_EVIDENCE: '/tmp/ci.json' },
    head, branch: 'feat/agent-u11c2-activation', status: '', upstream: head, outputExists: false,
    ci: { headRefOid: head, statusCheckRollup: ['verify (22.18.0)', 'verify (24)'].map(name => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' })) } };
  expect(() => validateSmokeAuthorization(input)).not.toThrow();
  for (const mutate of [
    row => row.args.push('--gate'), row => row.upstream = '3'.repeat(40), row => row.status = ' M source.ts',
    row => row.outputExists = true, row => row.head = '3'.repeat(40), row => row.ci.headRefOid = '3'.repeat(40),
    row => row.ci.statusCheckRollup[0].status = 'IN_PROGRESS', row => row.ci.statusCheckRollup[0].conclusion = 'FAILURE',
    row => row.ci.statusCheckRollup.pop(), row => row.env.UI_OUTPUT = 'relative',
  ]) {
    const invalid = structuredClone(input); mutate(invalid);
    expect(() => validateSmokeAuthorization(invalid), mutate.toString()).toThrow();
  }
});

test('exact smoke evidence passes with 300 total slice commands and native visibility always open', async () => {
  const result = await rootSmokeEvidence();
  expect(result.commandLog).toHaveLength(742);
  expect(result.scenarios[0].runs).toHaveLength(0);
  expect(result.scenarios[1].runs[0].issued).toHaveLength(300);
  expect(evaluateRootSmoke(result)).toEqual({ passes: true, failures: [], scope: ROOT_SMOKE_SCOPE, fullMatrixClaim: false, nativeVisibility: 'OPEN' });
});

test('missing, widened, retargeted and fabricated smoke evidence cannot pass stored checks', async () => {
  const original = await rootSmokeEvidence();
  for (const mutate of [
    row => row.scenarios[0].pickConflicts.pop(), row => row.scenarios[1].moveConflicts.pop(),
    row => row.scenarios[0].pickConflicts[0].barrier[1].slot = '2',
    row => row.scenarios[0].pickConflicts[0].results[1].observations.final.alert = 'Choose a player',
    row => row.scenarios[1].runs[0].issued.pop(), row => row.scenarios[1].runs[0].issued[0].actor = 'panel',
    row => row.scenarios[0].runs.push(row.scenarios[1].runs[0]), row => row.scenarios[0].control = row.scenarios[1].runs[0],
    row => row.scenarios[0].bursts.mock = { checks: { good: true } }, row => row.scenarios.push({ label: 'hostname-split' }),
    row => row.scenarios[0].bursts.reconcile.issued.pop(), row => row.scenarios[0].lifecycle.pop(),
    row => row.scenarios[1].panelSetup.workerReset.after.sentinelPresent = true,
    row => row.scenarios[1].panelSetup.nonceAfter = 'first', row => row.scenarios[1].panelSetup.hostPermission = false,
    row => row.commandLog[1].outcome = 'ack', row => row.commandLog.push(row.commandLog[0]),
    row => row.commandLog.find(value => value.cmd.id === 'setup:0').cmd.playerId = 'wrong',
    row => row.metadata.serve = 'vite-dev', row => row.metadata.sourceHashesEnd = {},
    row => row.metadata.expectedHead = 'wrong', row => row.metadata.config.perActor = 300,
    row => row.gate = { passes: true }, row => row.productionNavigationDefect = { message: 'unprompted' },
  ]) {
    const row = structuredClone(original); mutate(row);
    expect(evaluateRootSmoke(row).passes, mutate.toString()).toBe(false);
  }
});

test('each plan executes once in its exact order and stops on the first failed sample', async () => {
  const original = await rootSmokeEvidence();
  for (const scenario of original.scenarios) {
    const calls = [];
    const operations = {
      pickConflict: async sample => scenario.pickConflicts[sample - 1], moveConflict: async sample => scenario.moveConflicts[sample - 1],
      reconcile: async () => scenario.bursts.reconcile, lifecycle: async () => scenario.lifecycle,
      setup: async () => scenario.panelSetup, slice: async () => scenario.runs[0],
    };
    await runRootSmokeSteps(scenario.label, operations, async (kind, _row, sample) => calls.push([kind, sample]));
    expect(calls).toEqual(ROOT_SMOKE_PLAN[scenario.label].flatMap(([kind, count]) => Array.from({ length: count }, (_, i) => [kind, i + 1])));
    const failed = { ...operations, pickConflict: async () => ({ ...scenario.pickConflicts[0], results: [] }) };
    const stopped = [];
    await expect(runRootSmokeSteps(scenario.label, failed, async (kind, _row, sample) => stopped.push([kind, sample]))).rejects.toThrow('STOP without retry');
    expect(stopped.at(-1)).toEqual(['pickConflict', 1]);
    expect(stopped.filter(([kind]) => kind === 'moveConflict')).toHaveLength(0);
  }
});
