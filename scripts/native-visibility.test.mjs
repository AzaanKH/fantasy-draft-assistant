import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeVisibilityExitCode } from './persistence/native-visibility-result.mjs';

const source = await readFile(new URL('./persistence/native-visibility.mjs', import.meta.url), 'utf8');
const entry = source.slice(source.indexOf('try { await Effect.runPromise'));
const passing = () => ({ verdict: 'PROVEN', trials: ['tab-switch', 'minimize-restore'].flatMap(path => Array.from({ length: 5 }, () => ({ path, passes: true }))),
  pathVerdicts: { 'tab-switch': 'PROVEN', 'minimize-restore': 'PROVEN' }, pageErrors: [], cleanup: [] });

async function exitCode(result, cleanupFails = false) {
  const process = {};
  await runInNewContext(`(async () => { ${entry.replaceAll('import.meta.url', JSON.stringify(import.meta.url))} })()`, {
    result, process, Effect: { tryPromise: work => work(), runPromise: work => work }, run: async () => {},
    context: cleanupFails ? { close: async () => { throw new Error('Cleanup failed'); } } : undefined,
    server: undefined, persist: async () => {}, writeFile: async () => {}, path, fileURLToPath,
    root: '/', out: '/evidence', console: { log: () => {}, error: () => {} }, nativeVisibilityExitCode,
  });
  return process.exitCode ?? 0;
}

test('the native entry succeeds only when both complete paths pass', async () => {
  expect(await exitCode(passing())).toBe(0);
  for (const mutate of [
    result => { result.verdict = 'PRODUCT DEFECT'; },
    result => { result.verdict = 'NOT PROVEN'; },
    result => { result.pageErrors.push({ message: 'Uncaught page error' }); },
    result => { result.trials.pop(); },
    result => { result.trials[0].passes = false; },
  ]) {
    const result = passing(); mutate(result);
    expect(await exitCode(result), mutate.toString()).toBe(1);
  }
  expect(await exitCode(passing(), true)).toBe(1);
});
