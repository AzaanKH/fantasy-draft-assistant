import { test, expect } from 'vitest';
import { rootSmokeEvidence } from './persistence/fixtures/root-smoke-evidence.mjs';
import { ROOT_SMOKE_SCOPE, ROOT_SMOKE_PLAN, evaluateRootSmoke, runRootSmokeSteps, focusAfterAck } from './persistence/ui-root-smoke.mjs';
import { readFile } from 'node:fs/promises';
import { validateSmokeAuthorization } from './persistence/root-smoke-driver.mjs';

test('the smoke driver rejects unpushed, dirty, reused or non-green head evidence before launch', () => {
  const head = '2'.repeat(40);
  const input = { args: ['--browser-authorized'], env: { UI_EXPECTED_BRANCH: 'feat/agent-u11c2-activation', UI_EXPECTED_HEAD: head, UI_OUTPUT: '/tmp/fresh-smoke', UI_CI_EVIDENCE: '/tmp/ci.json' },
    head, branch: 'feat/agent-u11c2-activation', status: '', upstream: head, outputExists: false,
    ci: { headRefOid: head, statusCheckRollup: ['verify (22.18.0)', 'verify (24)'].map(name => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' })) } };
  expect(() => validateSmokeAuthorization(input)).not.toThrow();
  for (const mutate of [
    row => delete row.env.UI_EXPECTED_BRANCH, row => row.env.UI_EXPECTED_BRANCH = 'wrong-branch',
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

test('lifecycle recovery needs a trusted receiver focus after the sender ack', async () => {
  const ack = { startedAt: 1000, ms: 200 };
  expect(focusAfterAck([{ type: 'focus', trusted: true, at: 1300 }], ack)).toBe(true);
  for (const events of [
    [], [{ type: 'focus', trusted: true, at: 1100 }], [{ type: 'focus', trusted: false, at: 1300 }],
    [{ type: 'visibility', trusted: true, at: 1300 }], [{ type: 'focus', trusted: true }],
  ]) expect(focusAfterAck(events, ack), JSON.stringify(events)).toBe(false);
  const result = await rootSmokeEvidence();
  result.scenarios[0].lifecycle[1].focusRecovery.events[0].at = 900;
  expect(evaluateRootSmoke(result).passes).toBe(false);
});

test('the lifecycle scenario blurs the receiver before the write and judges focus by timestamp', async () => {
  const source = await readFile(new URL('./persistence/ui-activation.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function lifecycle('));
  expect(body.indexOf('await pages[receiver].bringToFront(); await pages[sender].bringToFront();')).toBeGreaterThan(-1);
  expect(body.indexOf('await pages[sender].bringToFront();')).toBeLessThan(body.indexOf("id: 'lifecycle:add'"));
  expect(body).toContain('proven: focusAfterAck(events, receipt)');
  expect(body).toContain('at: performance.timeOrigin + e.timeStamp');
});

test('fixture setup clicks League setup inside the details popover, never the readiness banner copy', async () => {
  const read = file => readFile(new URL(file, import.meta.url), 'utf8');
  const [runner, status, setup] = await Promise.all([read('./persistence/ui-activation.mjs'), read('../web-app/src/components/DraftSessionStatus.tsx'), read('../web-app/src/features/league-setup/LeagueSetupDialog.tsx')]);
  const body = runner.slice(runner.indexOf('async function fixtureRules('), runner.indexOf('async function inspectPoolControl('));
  expect(body).not.toMatch(/ctx\.getByRole\('button', \{ name: 'League setup'/);
  expect(body).toContain("ctx.getByRole('dialog', { name: 'Draft session details' }).getByRole('button', { name: 'League setup', exact: true })");
  expect(body).toContain("ctx.getByRole('dialog', { name: 'League setup', exact: true })");
  expect(status).toContain('<PopoverContent aria-label="Draft session details"');
  expect(setup).toContain('<DialogTitle>League setup</DialogTitle>');
});
