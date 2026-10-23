import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Processes } from '@fantasy-draft/shared/node';
import { evaluateRootSmoke, ROOT_SMOKE_SCOPE, ROOT_SMOKE_PLAN } from './ui-root-smoke.mjs';

export function validateSmokeAuthorization({ args, env, head, branch, status, ci, upstream, outputExists }) {
  assert.deepEqual(args, ['--browser-authorized'], 'Root must explicitly authorize this exact smoke driver');
  assert.match(env.UI_EXPECTED_HEAD ?? '', /^[a-f0-9]{40}$/);
  assert.notEqual(head, '1bdd194152b5486380b78ff5b4f11a893730e271', 'The failed full-matrix head cannot run this new product-fix smoke');
  assert.equal(head, env.UI_EXPECTED_HEAD); assert.equal(upstream, head, 'Push the reviewed head before smoke');
  assert.equal(branch, 'feat/agent-u11c2-activation'); assert.equal(status, '', 'Commit and freeze all sources');
  assert(path.isAbsolute(env.UI_OUTPUT ?? ''), 'Use a fresh absolute smoke output directory');
  assert(path.isAbsolute(env.UI_CI_EVIDENCE ?? ''), 'Provide exact-head CI JSON evidence');
  assert.equal(outputExists, false, 'Output already exists; inspect it and never retry');
  assert.equal(ci.headRefOid, head, 'CI evidence belongs to another head');
  assert(ci.statusCheckRollup?.length > 0 && ci.statusCheckRollup.every(row => row.__typename === 'CheckRun' ? row.status === 'COMPLETED' && row.conclusion === 'SUCCESS' : row.__typename === 'StatusContext' && row.state === 'SUCCESS'), 'Every exact-head CI check must be green');
  assert(ci.statusCheckRollup.some(row => row.name === 'verify (22.18.0)') && ci.statusCheckRollup.some(row => row.name === 'verify (24)'), 'Both Node verification jobs must be present');
}

export async function runSmokeDriver(args = process.argv.slice(2), inputEnv = process.env) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const git = async argv => (await Processes.run('git', argv, { cwd: root, timeoutMs: 30000, maxOutputBytes: 4000000 })).stdout.trim();
  const state = async () => ({ head: await git(['rev-parse', 'HEAD']), branch: await git(['branch', '--show-current']), status: await git(['status', '--porcelain', '--untracked-files=normal']) });
  const before = await state();
  const ci = JSON.parse(readFileSync(inputEnv.UI_CI_EVIDENCE, 'utf8'));
  validateSmokeAuthorization({ args, env: inputEnv, ...before, ci, upstream: await git(['rev-parse', 'origin/feat/agent-u11c2-activation']), outputExists: existsSync(inputEnv.UI_OUTPUT) });
  const out = inputEnv.UI_OUTPUT, sha = value => createHash('sha256').update(value).digest('hex');
  const tracked = (await Processes.run('git', ['ls-files', '-z'], { cwd: root, timeoutMs: 30000, maxOutputBytes: 4000000 })).stdout.split('\0').filter(Boolean);
  const sourceHashes = Object.fromEntries(tracked.map(file => [file, sha(readFileSync(path.join(root, file)))]));
  mkdirSync(out); const write = (name, value) => writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  write('driver-preflight.json', { ...before, driverPid: process.pid, ci, scope: ROOT_SMOKE_SCOPE, plan: ROOT_SMOKE_PLAN, sourceHashes, fullMatrixClaim: false });
  const env = { ...inputEnv, VITE_STORAGE_ACTIVATION: 'idb' };
  const unset = ['VITE_PERSISTENCE_HARNESS', 'VITE_DEMO_MODE', 'UI_SCENARIOS', 'UI_SUITES', 'UI_SEEDS', 'UI_COMMANDS_PER_ACTOR', 'UI_PICK_CONFLICTS', 'UI_MOVE_CONFLICTS', 'UI_BURSTS', 'UI_CONTROL', 'UI_LIFECYCLE', 'UI_BURST_PICKS'];
  for (const name of unset) delete env[name];
  let abort;
  const onSignal = () => abort?.abort(); process.on('SIGTERM', onSignal); process.on('SIGINT', onSignal);
  const run = async (label, command, argv, timeoutMs) => {
    const stdout = path.join(out, `${label}-stdout.log`), stderr = path.join(out, `${label}-stderr.log`);
    writeFileSync(stdout, '', { flag: 'wx' }); writeFileSync(stderr, '', { flag: 'wx' });
    write(`${label}-invocation.json`, { command, args: argv, head: before.head, at: new Date().toISOString(), timeoutMs, unset });
    abort = new AbortController();
    try {
      const result = await Processes.run(command, argv, { cwd: root, env, timeoutMs, maxOutputBytes: 1000000, signal: abort.signal,
        onStdout: text => appendFileSync(stdout, text), onStderr: text => appendFileSync(stderr, text) });
      write(`${label}-exit.json`, { at: new Date().toISOString(), result });
    } catch (error) { write(`${label}-exit.json`, { at: new Date().toISOString(), error: error.message, result: error.result }); throw error; }
  };
  let consumed = false, smoke, failure;
  try {
    await run('extension-build', 'pnpm', ['build:extension'], 120000);
    assert.deepEqual(await state(), before);
    write('SMOKE-CONSUMED.json', { head: before.head, driverPid: process.pid, at: new Date().toISOString(), invocations: 1, scope: ROOT_SMOKE_SCOPE, fullMatrixClaim: false, rollbackAuthorized: false });
    consumed = true;
    await run('smoke', 'node', ['scripts/persistence/ui-activation.mjs', '--root-tier2-smoke', '--browser-authorized'], 7200000);
    smoke = evaluateRootSmoke(JSON.parse(readFileSync(path.join(out, 'results.json'), 'utf8')));
    assert(smoke.passes, JSON.stringify(smoke.failures)); assert.deepEqual(await state(), before);
  } catch (error) { failure = { message: error.message, stack: error.stack }; }
  finally {
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    const after = await state();
    const changed = tracked.filter(file => sha(readFileSync(path.join(root, file))) !== sourceHashes[file]);
    const result = existsSync(path.join(out, 'results.json')) ? JSON.parse(readFileSync(path.join(out, 'results.json'), 'utf8')) : undefined;
    smoke ??= result ? evaluateRootSmoke(result) : undefined;
    write('driver-final-receipt.json', { at: new Date().toISOString(), head: before.head, after, changed, scope: ROOT_SMOKE_SCOPE, smoke, consumed,
      failure, sourceStable: !changed.length, fullMatrixClaim: false, rollbackInvocations: 0, fullMatrixInvocations: 0, retries: 0 });
    if (failure || changed.length || !smoke?.passes || JSON.stringify(after) !== JSON.stringify(before)) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runSmokeDriver();
