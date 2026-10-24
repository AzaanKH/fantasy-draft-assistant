import { scoreSlotOwnership } from './ui-slot-owner.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Processes } from '@fantasy-draft/shared/node';
import { evaluateRootSmoke, ROOT_SMOKE_SCOPE, ROOT_SMOKE_PLAN } from './ui-root-smoke.mjs';
import { evaluateReachability, PREFLIGHT_SCOPE, PREFLIGHT_PLAN } from './ui-reachability.mjs';

export function driverMode(args) {
  if (JSON.stringify(args) === JSON.stringify(['--reachability-only', '--browser-authorized'])) return {
    preflight: true, scope: PREFLIGHT_SCOPE, marker: 'PREFLIGHT-CLAIM.json', runnerFlag: '--root-tier2-preflight', plan: PREFLIGHT_PLAN,
  };
  assert.deepEqual(args, ['--browser-authorized'], 'Choose exactly the authorized preflight or smoke driver entry');
  return { preflight: false, scope: ROOT_SMOKE_SCOPE, marker: 'SMOKE-CONSUMED.json', runnerFlag: '--root-tier2-smoke', plan: ROOT_SMOKE_PLAN };
}

export function validateReachabilityAuthorization({ env, head, branch, status, outputExists }) {
  assert.match(env.UI_EXPECTED_HEAD ?? '', /^[a-f0-9]{40}$/);
  assert.equal(head, env.UI_EXPECTED_HEAD);
  assert.ok(env.UI_EXPECTED_BRANCH?.trim(), 'Set UI_EXPECTED_BRANCH explicitly');
  assert.equal(branch, env.UI_EXPECTED_BRANCH, 'Wrong expected branch'); assert.equal(status, '', 'Commit and freeze all sources');
  assert(path.isAbsolute(env.UI_OUTPUT ?? ''), 'Use a fresh absolute preflight output');
  assert.equal(outputExists, false, 'Preflight output exists; inspect it without launching');
}

export function validatePreflightReceipt(receipt, result, head) {
  assert.equal(receipt.head, head); assert.equal(receipt.scope, PREFLIGHT_SCOPE); assert.equal(receipt.consumed, false);
  assert.equal(receipt.sourceStable, true); assert.equal(receipt.failure, undefined);
  assert.equal(receipt.after.head, head); assert.equal(receipt.after.status, '');
  assert.equal(receipt.changed.length, 0); assert.equal(receipt.reachability.passes, true); assert.equal(receipt.reachability.workloadCommands, 0);
  assert(evaluateReachability(result).passes, 'All exact-head non-consuming reachability checks must pass before smoke');
  assert.equal(result.metadata.expectedHead, head);
}

export function validateSmokeAuthorization({ args, env, head, branch, status, ci, upstream, outputExists }) {
  assert.deepEqual(args, ['--browser-authorized'], 'Root must explicitly authorize this exact smoke driver');
  assert.match(env.UI_EXPECTED_HEAD ?? '', /^[a-f0-9]{40}$/);
  assert.notEqual(head, '1bdd194152b5486380b78ff5b4f11a893730e271', 'The failed full-matrix head cannot run this new product-fix smoke');
  assert.equal(head, env.UI_EXPECTED_HEAD); assert.equal(upstream, head, 'Push the reviewed head before smoke');
  assert.ok(env.UI_EXPECTED_BRANCH?.trim(), 'Set UI_EXPECTED_BRANCH explicitly');
  assert.equal(branch, env.UI_EXPECTED_BRANCH, 'Wrong expected branch'); assert.equal(status, '', 'Commit and freeze all sources');
  assert(path.isAbsolute(env.UI_OUTPUT ?? ''), 'Use a fresh absolute smoke output directory');
  assert(path.isAbsolute(env.UI_CI_EVIDENCE ?? ''), 'Provide exact-head CI JSON evidence');
  assert.equal(outputExists, false, 'Output already exists; inspect it and never retry');
  assert.equal(ci.headRefOid, head, 'CI evidence belongs to another head');
  assert(ci.statusCheckRollup?.length > 0 && ci.statusCheckRollup.every(row => row.__typename === 'CheckRun' ? row.status === 'COMPLETED' && row.conclusion === 'SUCCESS' : row.__typename === 'StatusContext' && row.state === 'SUCCESS'), 'Every exact-head CI check must be green');
  assert(ci.statusCheckRollup.some(row => row.name === 'verify (22.18.0)') && ci.statusCheckRollup.some(row => row.name === 'verify (24)'), 'Both Node verification jobs must be present');
}

export async function runSmokeDriver(args = process.argv.slice(2), inputEnv = process.env) {
  const mode = driverMode(args);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const git = async argv => (await Processes.run('git', argv, { cwd: root, timeoutMs: 30000, maxOutputBytes: 4000000 })).stdout.trim();
  const state = async () => ({ head: await git(['rev-parse', 'HEAD']), branch: await git(['branch', '--show-current']), status: await git(['status', '--porcelain', '--untracked-files=normal']) });
  const before = await state();
  const ci = mode.preflight ? undefined : JSON.parse(readFileSync(inputEnv.UI_CI_EVIDENCE, 'utf8'));
  assert.ok(inputEnv.UI_EXPECTED_BRANCH?.trim(), 'Set UI_EXPECTED_BRANCH explicitly');
  const authorization = { args, env: inputEnv, ...before, ci, upstream: await git(['rev-parse', `origin/${inputEnv.UI_EXPECTED_BRANCH}`]), outputExists: existsSync(inputEnv.UI_OUTPUT) };
  if (mode.preflight) validateReachabilityAuthorization(authorization);
  else {
    validateSmokeAuthorization(authorization);
    assert(path.isAbsolute(inputEnv.UI_PREFLIGHT_EVIDENCE ?? ''), 'Provide the passing exact-head preflight driver receipt');
    const directory = path.dirname(inputEnv.UI_PREFLIGHT_EVIDENCE);
    assert(!existsSync(path.join(directory, 'SMOKE-CONSUMED.json')), 'Workload evidence cannot masquerade as preflight');
    const claim = JSON.parse(readFileSync(path.join(directory, 'PREFLIGHT-CLAIM.json'), 'utf8'));
    assert.equal(claim.head, before.head); assert.equal(claim.scope, PREFLIGHT_SCOPE); assert.equal(claim.consumed, false);
    validatePreflightReceipt(JSON.parse(readFileSync(inputEnv.UI_PREFLIGHT_EVIDENCE, 'utf8')), JSON.parse(readFileSync(path.join(directory, 'results.json'), 'utf8')), before.head);
  }
  const out = inputEnv.UI_OUTPUT, sha = value => createHash('sha256').update(value).digest('hex');
  const tracked = (await Processes.run('git', ['ls-files', '-z'], { cwd: root, timeoutMs: 30000, maxOutputBytes: 4000000 })).stdout.split('\0').filter(Boolean);
  const sourceHashes = Object.fromEntries(tracked.map(file => [file, sha(readFileSync(path.join(root, file)))]));
  mkdirSync(out); const write = (name, value) => writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  write('driver-preflight.json', { ...before, driverPid: process.pid, ci, unit: inputEnv.UI_SLOT_OWNER, scope: mode.scope, plan: mode.plan, sourceHashes, fullMatrixClaim: false, preflight: mode.preflight });
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
  let consumed = false, smoke, reachability, failure;
  try {
    await run('extension-build', 'pnpm', ['build:extension'], 120000);
    assert.deepEqual(await state(), before);
    write(mode.marker, { head: before.head, driverPid: process.pid, at: new Date().toISOString(), invocations: 1, scope: mode.scope, consumed: !mode.preflight, fullMatrixClaim: false, rollbackAuthorized: false });
    consumed = !mode.preflight;
    await run(mode.preflight ? 'reachability' : 'smoke', 'node', ['scripts/persistence/ui-activation.mjs', mode.runnerFlag, '--browser-authorized'], mode.preflight ? 900000 : 7200000);
    const result = JSON.parse(readFileSync(path.join(out, 'results.json'), 'utf8'));
    const assessment = mode.preflight ? (reachability = evaluateReachability(result)) : (smoke = evaluateRootSmoke(result));
    if (mode.preflight && inputEnv.UI_SLOT_OWNER === 'u12') assert(result.scenarios[0]?.slotControl?.visible && result.scenarios[0]?.slotControl?.enabled, 'Unit 12 slot control unreachable');
    assert(assessment.passes, JSON.stringify(assessment.failures));
    if (!mode.preflight && inputEnv.UI_SLOT_OWNER === 'u12') assert(scoreSlotOwnership(result.scenarios[0]?.slotOwnership), 'Unit 12 slot checks missing or failed'); assert.deepEqual(await state(), before);
  } catch (error) { failure = { message: error.message, stack: error.stack }; }
  finally {
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    const after = await state();
    const changed = tracked.filter(file => sha(readFileSync(path.join(root, file))) !== sourceHashes[file]);
    const result = existsSync(path.join(out, 'results.json')) ? JSON.parse(readFileSync(path.join(out, 'results.json'), 'utf8')) : undefined;
    if (mode.preflight) reachability ??= result ? evaluateReachability(result) : undefined;
    else smoke ??= result ? evaluateRootSmoke(result) : undefined;
    write('driver-final-receipt.json', { at: new Date().toISOString(), head: before.head, after, changed, scope: mode.scope, smoke, reachability, consumed,
      slotOwnership: result?.scenarios?.[0]?.slotOwnership, slotOwnershipPasses: inputEnv.UI_SLOT_OWNER === 'u12' && !mode.preflight ? scoreSlotOwnership(result?.scenarios?.[0]?.slotOwnership) : undefined,
      failure, sourceStable: !changed.length, fullMatrixClaim: false, rollbackInvocations: 0, fullMatrixInvocations: 0, retries: 0 });
    if (failure || changed.length || !(mode.preflight ? reachability : smoke)?.passes || JSON.stringify(after) !== JSON.stringify(before)) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runSmokeDriver();
