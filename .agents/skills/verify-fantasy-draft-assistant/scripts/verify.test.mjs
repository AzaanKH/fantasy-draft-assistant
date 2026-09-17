import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanup, driveRosterSettings, processIdentity, terminateGroup } from './verify.mjs';

const artifactsRoot = fileURLToPath(new URL('../artifacts/', import.meta.url));

async function processFixture(t) {
  const childCode = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.send('ready');";
  const parentCode = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    child.once('message', () => process.send(child.pid));
    process.on('message', () => process.exit(0));
  `;
  const leader = spawn(process.execPath, ['-e', parentCode], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const [childPid] = await once(leader, 'message');
  const leaderIdentity = processIdentity(leader.pid);
  const childIdentity = processIdentity(childPid);
  assert.equal(childIdentity.pgid, leader.pid);
  t.after(async () => {
    // Only signal a fixture group while one of its recorded identities matches.
    for (const expected of [leaderIdentity, childIdentity]) {
      try {
        const actual = processIdentity(expected.pid);
        if (actual.pgid === expected.pgid && actual.startedAt === expected.startedAt) {
          process.kill(-expected.pgid, 'SIGKILL');
          break;
        }
      } catch { /* The fixture already exited. */ }
    }
    if (leader.exitCode === null && leader.signalCode === null) await once(leader, 'exit');
  });
  return { leader, leaderIdentity, childIdentity };
}

async function runtimeFixture(t, processState) {
  const runId = `cleanup-test-${process.pid}-${Date.now()}`;
  const artifacts = path.join(artifactsRoot, runId);
  const runtime = path.join('/tmp/fantasy-draft-assistant-verification', runId);
  await mkdir(artifacts, { recursive: true });
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, 'marker'), 'preserve until termination is confirmed');
  const stateFile = path.join(artifacts, 'run.json');
  await writeFile(stateFile, JSON.stringify({
    runId, status: 'running', ...processState, webPort: 0, apiPort: 0,
  }));
  t.after(async () => {
    await rm(artifacts, { recursive: true, force: true });
    await rm(runtime, { recursive: true, force: true });
  });
  return { runId, runtime, stateFile };
}

test('cleanup terminates a recorded surviving child after the leader exits', { timeout: 15000 }, async (t) => {
  const { leader, leaderIdentity, childIdentity } = await processFixture(t);
  const fixture = await runtimeFixture(t, {
    pgid: leader.pid, processGroupLeader: leaderIdentity, processGroupMembers: [childIdentity],
  });
  const exited = once(leader, 'exit');
  leader.send('exit');
  await exited;
  await cleanup(fixture.runId);
  await assert.rejects(readFile(path.join(fixture.runtime, 'marker')), { code: 'ENOENT' });
  const state = JSON.parse(await readFile(fixture.stateFile, 'utf8'));
  assert.equal(state.status, 'cleaned');
  assert.equal(state.runtimeRemoved, true);
  assert.throws(() => process.kill(childIdentity.pid, 0), { code: 'ESRCH' });
});

test('termination authenticates children again when the leader exits during SIGTERM', { timeout: 15000 }, async (t) => {
  const { leader, leaderIdentity, childIdentity } = await processFixture(t);
  await terminateGroup(leader.pid, leaderIdentity);
  assert.throws(() => process.kill(childIdentity.pid, 0), { code: 'ESRCH' });
});

test('cleanup preserves the runtime and reports blocked for unverified surviving children', async (t) => {
  const { leader, leaderIdentity, childIdentity } = await processFixture(t);
  const fixture = await runtimeFixture(t, {
    pgid: leader.pid,
    processGroupLeader: leaderIdentity,
    processGroupMembers: [{ ...childIdentity, startedAt: 'a different process' }],
  });
  const exited = once(leader, 'exit');
  leader.send('exit');
  await exited;
  await assert.rejects(cleanup(fixture.runId), /Cleanup blocked: cannot authenticate/);
  assert.equal(await readFile(path.join(fixture.runtime, 'marker'), 'utf8'), 'preserve until termination is confirmed');
  assert.equal(process.kill(childIdentity.pid, 0), true);
  const state = JSON.parse(await readFile(fixture.stateFile, 'utf8'));
  assert.equal(state.status, 'cleanup-blocked');
  assert.equal(state.runtimeRemoved, false);
  assert.equal(state.cleanedAt, undefined);
});

test('cleanup preserves the runtime if a listener survives outside the recorded group', { timeout: 15000 }, async (t) => {
  const { leader, leaderIdentity } = await processFixture(t);
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const fixture = await runtimeFixture(t, {
    pgid: leader.pid, processGroupLeader: leaderIdentity, webPort: port,
  });
  // runtimeFixture defaults to unused ports; record this independent listener.
  const state = JSON.parse(await readFile(fixture.stateFile, 'utf8'));
  await writeFile(fixture.stateFile, JSON.stringify({ ...state, webPort: port }));
  await assert.rejects(cleanup(fixture.runId), /still has an unverified listener/);
  assert.equal(server.listening, true);
  assert.equal((JSON.parse(await readFile(fixture.stateFile, 'utf8'))).status, 'cleanup-blocked');
  assert.equal(await readFile(path.join(fixture.runtime, 'marker'), 'utf8'), 'preserve until termination is confirmed');
});

function rosterPage(resetWorks) {
  let value = '1';
  const control = {
    waitFor: async () => {},
    inputValue: async () => value,
    fill: async (next) => { value = next; },
    getByLabel: () => control,
    getByRole: (_role, options) => ({
      ...control,
      click: async () => {
        if (options?.name === 'Reset defaults' && resetWorks) value = '1';
      },
    }),
    ariaSnapshot: async () => `QB: ${value}`,
  };
  return {
    ...control,
    goto: async () => {},
    screenshot: async () => {},
    locator: () => control,
  };
}

for (const resetWorks of [true, false]) {
  test(`roster verification ${resetWorks ? 'passes a confirmed' : 'rejects a failed'} reset`, async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'roster-verification-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const result = driveRosterSettings(rosterPage(resetWorks), dir, { webUrl: 'http://fixture' });
    if (resetWorks) {
      assert.match((await result).observedResult, /reset to 1/);
    } else {
      await assert.rejects(result, /QB starter value did not reset to 1: 2/);
    }
  });
}
