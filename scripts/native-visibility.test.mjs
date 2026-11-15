import { expect, test } from 'vitest';
import { nativeVisibilityExitCode } from './persistence/native-visibility-result.mjs';

const passing = () => ({ verdict: 'PROVEN', trials: ['tab-switch', 'minimize-restore'].flatMap(path => Array.from({ length: 5 }, () => ({ path, passes: true }))),
  pathVerdicts: { 'tab-switch': 'PROVEN', 'minimize-restore': 'PROVEN' }, pageErrors: [], cleanup: ['Remaining browser closed'] });

test('the native entry succeeds only when both complete paths pass', () => {
  expect(nativeVisibilityExitCode(passing())).toBe(0);
  for (const mutate of [
    result => { result.verdict = 'PRODUCT DEFECT'; },
    result => { result.verdict = 'NOT PROVEN'; },
    result => { result.error = { message: 'run failed' }; },
    result => { result.pageErrors.push({ message: 'Uncaught page error' }); },
    result => { result.trials.pop(); },
    result => { result.trials[0].passes = false; },
    result => { result.cleanup.push({ error: 'Cleanup failed' }); },
  ]) {
    const result = passing(); mutate(result);
    expect(nativeVisibilityExitCode(result), mutate.toString()).toBe(1);
  }
});
