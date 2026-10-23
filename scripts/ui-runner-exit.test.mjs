import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { rootSmokeEvidence } from './persistence/fixtures/root-smoke-evidence.mjs';
import { evaluateRootSmoke } from './persistence/ui-root-smoke.mjs';
import { runnerExitCode } from './persistence/ui-runner-mode.mjs';

const withoutEndSnapshot = (result) => {
  const early = structuredClone(result);
  delete early.metadata.gitEnd;
  delete early.metadata.sourceHashesEnd;
  return early;
};

test('a passing run exits 0 even though the pre-cleanup verdict lacked the end snapshot', async () => {
  const final = await rootSmokeEvidence();
  expect(evaluateRootSmoke(withoutEndSnapshot(final)).passes).toBe(false);
  final.rootSmoke = evaluateRootSmoke(final);
  expect(runnerExitCode(final, { rootTier2Smoke: true })).toBe(0);
});

test('any final failure still exits 1', async () => {
  const final = await rootSmokeEvidence();
  final.rootSmoke = evaluateRootSmoke(final);
  for (const mutate of [
    row => row.fatal = { message: 'boom' }, row => row.pageErrors.push('x'), row => row.cleanupErrors.push('x'),
    row => row.scenarioErrors.push({}), row => row.metadata.sourceStable = false, row => row.setupCheck = { passes: false },
    row => row.rootSmoke.passes = false,
  ]) {
    const invalid = structuredClone(final); mutate(invalid);
    expect(runnerExitCode(invalid, { rootTier2Smoke: true }), mutate.toString()).toBe(1);
  }
  expect(runnerExitCode({ ...final, reachability: { passes: false } }, { rootTier2Preflight: true })).toBe(1);
});

test('the runner sets its exit status only after cleanup, apart from the fatal catch', async () => {
  const source = await readFile(new URL('./persistence/ui-activation.mjs', import.meta.url), 'utf8');
  const assignments = source.match(/process\.exitCode\s*=[^;]*;/g);
  expect(assignments).toEqual([
    'process.exitCode = 1;',
    "process.exitCode = runnerExitCode(results, { tier2, gate: flag('gate'), rootTier2Smoke, rootTier2Preflight });",
  ]);
  expect(source.indexOf('process.exitCode = runnerExitCode(')).toBeGreaterThan(source.indexOf('results.metadata.sourceHashesEnd = await sourceSnapshot();'));
});
