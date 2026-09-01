#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const skillRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(skillRoot, '../../..');
const artifactsRoot = path.join(skillRoot, 'artifacts');
const runtimeBase = path.join('/tmp', 'fantasy-draft-assistant-verification');
const readinessTimeoutMs = 5_000;
const scenarios = new Set([
  'workspace-queue',
  'connection-dialog',
  'sleeper-provider',
  'mock-start',
  'assistant-navigation',
  'roster-settings',
  'sidepanel-preview',
]);

function usage() {
  process.stdout.write([
    'Usage:',
    '  verify.mjs launch <run-id>',
    '  verify.mjs doctor <run-id>',
    '  verify.mjs drive <run-id> <scenario> [scenario-arguments]',
    '  verify.mjs cleanup <run-id>',
    '  verify.mjs help',
    '',
    `Scenarios: ${[...scenarios].join(', ')}`,
    '  sleeper-provider arguments: <https://sleeper.com/draft/nfl/<draft-id>> [draft-slot]',
    '',
  ].join('\n'));
}

function requireRunId(value) {
  if (!value || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error('Run ID must contain only letters, digits, dots, underscores, or hyphens.');
  }
  return value;
}

function requireSleeperDraftUrl(value) {
  if (!value) {
    throw new Error('sleeper-provider requires an explicit Sleeper mock draft URL.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Sleeper mock draft URL must be a valid HTTPS URL.');
  }

  const hostname = url.hostname.toLowerCase();
  const allowedHost = hostname === 'sleeper.com' || hostname === 'www.sleeper.com';
  const match = url.pathname.match(/^\/draft\/nfl\/(\d+)\/?$/);
  if (url.protocol !== 'https:' || !allowedHost || !match?.[1]) {
    throw new Error(
      'Sleeper mock draft URL must match https://sleeper.com/draft/nfl/<numeric-draft-id>.'
    );
  }

  return {
    url: url.href,
    draftId: match[1],
  };
}

function requireDraftSlot(value = '1') {
  const draftSlot = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || !Number.isInteger(draftSlot) || draftSlot < 1) {
    throw new Error('Draft slot must be a positive integer.');
  }
  return draftSlot;
}

function artifactDir(runId) {
  return path.join(artifactsRoot, requireRunId(runId));
}

function runtimeRoot(runId) {
  return path.join(runtimeBase, requireRunId(runId));
}

function runtimeRepo(runId) {
  return path.join(runtimeRoot(runId), 'repo');
}

function statePath(runId) {
  return path.join(artifactDir(runId), 'run.json');
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(target) {
  return JSON.parse(await readFile(target, 'utf8'));
}

function capture(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`
    );
  }
  return result.stdout.trim();
}

function listenerPids(port) {
  const result = spawnSync(
    'lsof',
    ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-t'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (result.status === 1 && result.stdout.trim() === '') return [];
  if (result.status !== 0) {
    throw new Error(`Could not inspect port ${String(port)}: ${result.stderr.trim()}`);
  }
  return [...new Set(result.stdout.trim().split(/\s+/).filter(Boolean).map(Number))];
}

async function canBind(host, port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.once('listening', () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
    server.listen(port, host);
  });
}

async function assertPortsFree(webPort, apiPort) {
  const checks = await Promise.all([
    canBind('localhost', webPort),
    canBind('127.0.0.1', apiPort),
  ]);
  if (
    checks.some((free) => !free) ||
    listenerPids(webPort).length > 0 ||
    listenerPids(apiPort).length > 0
  ) {
    throw new Error(
      `Verification ports ${String(webPort)} and ${String(apiPort)} must be free. Refusing to drive an existing app instance.`
    );
  }
}

async function findAvailablePort(host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error(`Could not allocate an isolated port on ${host}.`));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
    server.listen(0, host);
  });
}

function hasFantasyProsCredential(contents) {
  return contents.split(/\r?\n/).some((line) => {
    const match = line.match(/^\s*FANTASYPROS_API_KEY\s*=\s*(.*?)\s*$/);
    if (!match) return false;
    const value = match[1].replace(/^['"]|['"]$/g, '');
    return value.length > 0 && value !== 'replace_me' && value !== 'your_key_here';
  });
}

async function assertCredential(targetRepo = repoRoot) {
  const envPath = path.join(targetRepo, '.env.local');
  if (!(await exists(envPath))) {
    throw new Error('Repository-root .env.local is required for the live FantasyPros refresh.');
  }
  if (!hasFantasyProsCredential(await readFile(envPath, 'utf8'))) {
    throw new Error('FANTASYPROS_API_KEY is missing or placeholder in .env.local.');
  }
}

async function runLogged(command, args, cwd, logPath) {
  await mkdir(path.dirname(logPath), { recursive: true });
  const stream = createWriteStream(logPath, { flags: 'a' });
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  stream.end();
  if (outcome.code !== 0) {
    const detail = outcome.signal ? `signal ${outcome.signal}` : `exit code ${String(outcome.code)}`;
    throw new Error(`${command} ${args.join(' ')} failed with ${detail}. See ${logPath}.`);
  }
}

async function copyCheckout(runId) {
  const destination = runtimeRepo(runId);
  await mkdir(destination, { recursive: true });
  await runLogged(
    'rsync',
    [
      '-a',
      '--exclude=.git/',
      '--exclude=node_modules/',
      '--exclude=.agents/skills/verify-fantasy-draft-assistant/artifacts/',
      `${repoRoot}/`,
      `${destination}/`,
    ],
    repoRoot,
    path.join(artifactDir(runId), 'copy.log')
  );

  for (const workspace of ['', 'scripts', 'web-app', 'server', 'extension', 'shared']) {
    const source = path.join(repoRoot, workspace, 'node_modules');
    const target = path.join(destination, workspace, 'node_modules');
    if (await exists(source)) {
      await symlink(source, target, 'dir');
    }
  }
}

async function configureDisposablePorts(runId, webPort, apiPort) {
  const destination = runtimeRepo(runId);
  const viteConfigPath = path.join(destination, 'web-app', 'vite.config.ts');
  const portCheckPath = path.join(destination, 'scripts', 'src', 'check-dev-ports.ts');
  let viteConfig = await readFile(viteConfigPath, 'utf8');
  const replacements = [
    ['port: 3000,', `port: ${String(webPort)},`],
    ["target: 'http://localhost:3001',", `target: 'http://127.0.0.1:${String(apiPort)}',`],
    ["Origin: 'http://localhost:3000',", `Origin: 'http://localhost:${String(webPort)}',`],
  ];
  for (const [before, after] of replacements) {
    if (!viteConfig.includes(before)) {
      throw new Error(`Disposable port setup could not find ${before} in web-app/vite.config.ts.`);
    }
    viteConfig = viteConfig.replace(before, after);
  }
  await writeFile(viteConfigPath, viteConfig, 'utf8');

  let portCheck = await readFile(portCheckPath, 'utf8');
  const defaultPorts = 'const DEV_PORTS = [3000, 3001] as const;';
  if (!portCheck.includes(defaultPorts)) {
    throw new Error('Disposable port setup could not find the development port list.');
  }
  portCheck = portCheck.replace(
    defaultPorts,
    `const DEV_PORTS = [${String(webPort)}, ${String(apiPort)}] as const;`
  );
  await writeFile(portCheckPath, portCheck, 'utf8');
}

function processGroupId(pid) {
  return Number(capture('ps', ['-o', 'pgid=', '-p', String(pid)]));
}

function processCommand(pid) {
  return capture('ps', ['-o', 'command=', '-p', String(pid)]);
}

function processIdentity(pid) {
  return {
    pid,
    pgid: processGroupId(pid),
    startedAt: capture('ps', ['-o', 'lstart=', '-p', String(pid)]),
  };
}

function matchesProcessGroupLeader(pgid, expected) {
  if (!expected || expected.pid !== pgid || expected.pgid !== pgid) return false;
  try {
    const actual = processIdentity(pgid);
    return actual.pgid === pgid && actual.startedAt === expected.startedAt;
  } catch {
    return false;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readiness(webUrl, apiUrl) {
  const signal = AbortSignal.timeout(readinessTimeoutMs);
  const [web, api] = await Promise.all([
    fetch(`${webUrl}/draft`, { signal }),
    fetch(`${apiUrl}/api/health`, { signal }),
  ]);
  const health = await api.json();
  return {
    passed: web.status === 200 && api.status === 200 && health?.ok === true,
    web,
    api,
    health,
  };
}

async function terminateGroup(pgid, leaderIdentity) {
  if (
    !Number.isInteger(pgid) ||
    pgid <= 1 ||
    !groupAlive(pgid) ||
    !matchesProcessGroupLeader(pgid, leaderIdentity)
  ) return;
  process.kill(-pgid, 'SIGTERM');
  for (let attempt = 0; attempt < 50 && groupAlive(pgid); attempt += 1) {
    await wait(100);
  }
  if (groupAlive(pgid)) {
    process.kill(-pgid, 'SIGKILL');
  }
}

async function launch(runId) {
  requireRunId(runId);
  const evidence = artifactDir(runId);
  const runtime = runtimeRoot(runId);
  if (await exists(evidence) || await exists(runtime)) {
    throw new Error(`Run ID ${runId} already exists. Use a new run ID.`);
  }

  const webPort = await findAvailablePort('localhost');
  let apiPort = await findAvailablePort('127.0.0.1');
  while (apiPort === webPort) {
    apiPort = await findAvailablePort('127.0.0.1');
  }
  await assertPortsFree(webPort, apiPort);
  await assertCredential();
  await mkdir(evidence, { recursive: true });
  await mkdir(runtimeBase, { recursive: true });

  let state = {
    runId,
    status: 'preparing',
    sourceRepo: repoRoot,
    runtimeRoot: runtime,
    runtimeRepo: runtimeRepo(runId),
    artifacts: evidence,
    startedAt: new Date().toISOString(),
    sourceRevision: capture('git', ['rev-parse', 'HEAD']),
    sourceDirtyEntries: capture('git', ['status', '--short']).split(/\r?\n/).filter(Boolean).length,
    webPort,
    apiPort,
    webUrl: `http://localhost:${String(webPort)}`,
    apiUrl: `http://127.0.0.1:${String(apiPort)}`,
  };
  await writeJson(statePath(runId), state);

  let pid = null;
  let pgid = null;
  let processGroupLeader = null;
  try {
    await copyCheckout(runId);
    await configureDisposablePorts(runId, webPort, apiPort);
    await assertCredential(runtimeRepo(runId));
    await runLogged('pnpm', ['build'], runtimeRepo(runId), path.join(evidence, 'build.log'));
    const buildOutputs = [
      'web-app/dist/index.html',
      'server/dist/index.js',
      'extension/dist/manifest.json',
    ];
    for (const relativePath of buildOutputs) {
      if (!(await exists(path.join(runtimeRepo(runId), relativePath)))) {
        throw new Error(`Build output missing: ${relativePath}`);
      }
    }
    await writeJson(path.join(evidence, 'build.json'), {
      passed: true,
      command: 'pnpm build',
      outputs: buildOutputs,
      completedAt: new Date().toISOString(),
    });

    const logFd = await import('node:fs').then(({ openSync }) =>
      openSync(path.join(evidence, 'startup.log'), 'a')
    );
    const child = spawn('pnpm', ['dev:live'], {
      cwd: runtimeRepo(runId),
      env: {
        ...process.env,
        PORT: String(apiPort),
        SYNC_ALLOWED_ORIGINS: state.webUrl,
      },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    pid = child.pid;
    pgid = child.pid;
    processGroupLeader = processIdentity(pid);
    if (processGroupLeader.pgid !== pgid) {
      throw new Error(`Spawned process ${String(pid)} did not lead process group ${String(pgid)}.`);
    }
    state = {
      ...state,
      status: 'starting',
      pid,
      pgid,
      processGroupLeader,
      command: 'pnpm dev:live',
    };
    await writeJson(statePath(runId), state);

    const deadline = Date.now() + 180_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (!processAlive(pid)) break;
      try {
        ready = (await readiness(state.webUrl, state.apiUrl)).passed;
      } catch {
        ready = false;
      }
      if (ready) break;
      await wait(500);
    }
    if (!ready) {
      throw new Error(`Live startup did not become ready. See ${path.join(evidence, 'startup.log')}.`);
    }

    child.unref();
    state = { ...state, status: 'running', readyAt: new Date().toISOString() };
    await writeJson(statePath(runId), state);
    process.stdout.write(`${JSON.stringify({
      runId,
      status: 'running',
      pid,
      pgid,
      webUrl: state.webUrl,
      apiUrl: state.apiUrl,
      artifacts: evidence,
    }, null, 2)}\n`);
  } catch (error) {
    if (pgid) await terminateGroup(pgid, processGroupLeader);
    await rm(runtime, { recursive: true, force: true });
    state = {
      ...state,
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    await writeJson(statePath(runId), state);
    throw error;
  }
}

async function doctorReport(runId) {
  const state = await readJson(statePath(runId));
  if (state.status !== 'running') {
    throw new Error(`Run ${runId} is ${state.status}, not running.`);
  }
  if (!(await exists(state.runtimeRepo))) {
    throw new Error(`Disposable repo is missing: ${state.runtimeRepo}`);
  }
  if (!processAlive(state.pid)) {
    throw new Error(`Recorded process ${String(state.pid)} is not alive.`);
  }
  const actualPgid = processGroupId(state.pid);
  if (actualPgid !== state.pgid) {
    throw new Error(`Recorded process group ${String(state.pgid)} does not match ${String(actualPgid)}.`);
  }

  const ports = {};
  for (const port of [state.webPort, state.apiPort]) {
    const pids = listenerPids(port);
    if (pids.length === 0) throw new Error(`Port ${String(port)} has no listener.`);
    const owners = pids.map((pid) => ({ pid, pgid: processGroupId(pid), command: processCommand(pid) }));
    if (owners.some((owner) => owner.pgid !== state.pgid)) {
      throw new Error(`Port ${String(port)} has a listener outside process group ${String(state.pgid)}.`);
    }
    ports[port] = owners;
  }

  const buildOutputs = [
    'web-app/dist/index.html',
    'server/dist/index.js',
    'extension/dist/manifest.json',
  ];
  for (const relativePath of buildOutputs) {
    if (!(await exists(path.join(state.runtimeRepo, relativePath)))) {
      throw new Error(`Build output missing: ${relativePath}`);
    }
  }

  await assertCredential(state.runtimeRepo);
  const fantasyPros = await readJson(path.join(state.runtimeRepo, 'data/fantasypros-snapshot.json'));
  const identity = await readJson(path.join(state.runtimeRepo, 'data/player-identity.json'));
  if (fantasyPros?.metadata?.sourceType !== 'api') {
    throw new Error(`FantasyPros source must be api, received ${String(fantasyPros?.metadata?.sourceType)}.`);
  }
  if ((identity?.coverage?.fantasyProsRankingMatchRate ?? 0) < 0.98) {
    throw new Error('Canonical identity coverage is below 98%.');
  }
  if (identity?.coverage?.matchedDefenses !== 32) {
    throw new Error('Canonical identity data does not contain all 32 matched defenses.');
  }

  const { passed, web, api, health } = await readiness(state.webUrl, state.apiUrl);
  if (!passed) {
    throw new Error('Readiness endpoints failed doctor.');
  }

  return {
    passed: true,
    checkedAt: new Date().toISOString(),
    runId,
    process: {
      pid: state.pid,
      pgid: state.pgid,
      command: processCommand(state.pid),
    },
    build: { passed: true, outputs: buildOutputs },
    ports,
    dataDirectory: path.join(state.runtimeRepo, 'data'),
    authentication: { fantasyProsApiKey: 'present', browserProfile: 'fresh-per-drive' },
    coreData: {
      fantasyProsSourceType: fantasyPros.metadata.sourceType,
      rankingMatchRate: identity.coverage.fantasyProsRankingMatchRate,
      matchedDefenses: identity.coverage.matchedDefenses,
      identityRecords: identity.coverage.identityRecords,
    },
    readiness: {
      web: { url: `${state.webUrl}/draft`, status: web.status },
      api: { url: `${state.apiUrl}/api/health`, status: api.status, body: health },
    },
  };
}

async function doctor(runId) {
  process.stdout.write(`${JSON.stringify(await doctorReport(runId), null, 2)}\n`);
}

async function capturePage(page, targetDir, prefix) {
  await page.screenshot({ path: path.join(targetDir, `${prefix}.png`), fullPage: true });
  const aria = await page.locator('body').ariaSnapshot();
  await writeFile(path.join(targetDir, `${prefix}-aria.yml`), `${aria}\n`, 'utf8');
}

async function loadDraft(page, webUrl) {
  await page.goto(`${webUrl}/draft`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Draft board' }).waitFor();
  await page.locator('section[aria-label="Draft tools"]').waitFor();
}

async function driveWorkspaceQueue(page, targetDir, input) {
  await page.goto(`${input.webUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => url.pathname === '/draft');
  await page.getByRole('heading', { name: 'Draft board' }).waitFor();
  await page.locator('section[aria-label="Draft tools"]').waitFor();
  await page.waitForLoadState('networkidle');
  await loadDraft(page, input.webUrl);
  const add = page.getByRole('button', { name: /^Add .+ to local shortlist$/ }).first();
  await add.waitFor();
  const label = await add.getAttribute('aria-label');
  const match = label?.match(/^Add (.+) to local shortlist$/);
  if (!match) throw new Error(`Unexpected shortlist label: ${String(label)}`);
  const playerName = match[1];
  await capturePage(page, targetDir, 'before');
  await add.click();
  await page.getByRole('tab', { name: /^Queue\s+1$/ }).click();
  const confirmation = page.getByRole('button', { name: `Remove ${playerName} from queue` });
  await confirmation.waitFor();
  await capturePage(page, targetDir, 'after');
  return {
    featureId: 'workspace.local-shortlist',
    route: '/draft',
    handle: label,
    input: { playerName },
    observedResult: `${playerName} appears in Queue`,
    secondReadOnlyView: `Queue tab exposes Remove ${playerName} from queue`,
  };
}

async function driveConnectionDialog(page, targetDir, input) {
  await loadDraft(page, input.webUrl);
  const trigger = page.getByRole('button', { name: /^(Connect draft|Connect to verify)$/ });
  await trigger.waitFor();
  await capturePage(page, targetDir, 'before');
  const handle = await trigger.textContent();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Live draft sync' }).waitFor();
  const provider = dialog.getByLabel('Draft provider');
  const providerValue = await provider.inputValue();
  const draftField = dialog.getByLabel(/draft URL or ID$/);
  await draftField.waitFor();
  await capturePage(page, targetDir, 'after');
  return {
    featureId: 'connection.open-dialog',
    route: '/draft',
    handle: handle?.trim(),
    input: null,
    observedResult: `Live draft sync opened with provider ${providerValue}`,
    secondReadOnlyView: 'The dialog exposes the provider selector and labeled draft URL or ID input',
  };
}

async function readSleeperProviderSnapshot(draftId, webUrl, apiUrl) {
  const response = await fetch(
    `${apiUrl}/api/sync/sleeper/drafts/${encodeURIComponent(draftId)}`,
    { headers: { Origin: webUrl } }
  );
  if (!response.ok) {
    throw new Error(`Read-only Sleeper snapshot returned HTTP ${String(response.status)}.`);
  }

  const snapshot = await response.json();
  if (
    snapshot?.provider !== 'sleeper' ||
    snapshot?.draftId !== draftId ||
    snapshot?.status !== 'synced' ||
    snapshot?.draft?.providerKey !== draftId ||
    !Number.isInteger(snapshot?.draft?.settings?.teams) ||
    snapshot.draft.settings.teams < 1 ||
    !Number.isInteger(snapshot?.draft?.settings?.rounds) ||
    snapshot.draft.settings.rounds < 1 ||
    !Array.isArray(snapshot?.picks)
  ) {
    throw new Error('Read-only Sleeper snapshot was not a complete synced provider response.');
  }
  return snapshot;
}

async function driveSleeperProvider(page, targetDir, input) {
  const { sleeperDraftUrl, draftId, draftSlot, webUrl, apiUrl } = input;
  await loadDraft(page, webUrl);
  const trigger = page.getByRole('button', { name: /^(Connect draft|Connect to verify)$/ });
  await trigger.waitFor();
  await trigger.click();

  let dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Live draft sync' }).waitFor();
  await dialog.getByLabel('Draft provider').selectOption('sleeper');
  const draftInput = dialog.getByLabel('Sleeper draft URL or ID');
  await draftInput.fill(sleeperDraftUrl);
  await capturePage(page, targetDir, 'before');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  const draftSlotSelect = dialog.getByLabel('Your draft slot');
  await draftSlotSelect.waitFor();
  const availableSlots = await draftSlotSelect.locator('option').evaluateAll(
    (options) => options.map((option) => option.value)
  );
  if (!availableSlots.includes(String(draftSlot))) {
    throw new Error(
      `Draft slot ${String(draftSlot)} is unavailable. Provider reported slots ${availableSlots.join(', ')}.`
    );
  }
  await draftSlotSelect.selectOption(String(draftSlot));
  await dialog.getByRole('button', { name: 'Start syncing' }).click();
  const manageConnection = page.getByRole('button', {
    name: 'Manage Sleeper draft connection',
  });
  await manageConnection.waitFor();
  await page.getByRole('status', { name: /^Provider Truth confirmed\./ }).waitFor();
  await capturePage(page, targetDir, 'after');

  const snapshot = await readSleeperProviderSnapshot(draftId, webUrl, apiUrl);
  await writeJson(path.join(targetDir, 'provider-snapshot.json'), snapshot);

  await manageConnection.click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Live draft sync' }).waitFor();
  await dialog.getByText('Picks synced', { exact: true }).waitFor();

  return {
    featureId: 'connection.sleeper-provider-rehearsal',
    route: '/draft',
    handle: 'Live draft sync > Sleeper draft URL or ID',
    input: { sleeperDraftUrl, draftId, draftSlot },
    observedResult: `Sleeper draft ${draftId} connected with ${String(snapshot.picks.length)} provider picks`,
    secondReadOnlyView: 'provider-snapshot.json records the canonical synced response from /api/sync/sleeper/drafts/<draft-id>',
    providerSettings: {
      teams: snapshot.draft.settings.teams,
      rounds: snapshot.draft.settings.rounds,
      leagueSettingsAvailable: snapshot.draft.leagueSettings !== undefined,
    },
  };
}

async function driveMockStart(page, targetDir, input) {
  await loadDraft(page, input.webUrl);
  await page.getByText('Mock ready', { exact: true }).waitFor();
  const trigger = page.getByRole('button', { name: 'Start mock' });
  await capturePage(page, targetDir, 'before');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Start a mock draft' }).waitFor();
  const leagueTeams = await dialog.getByLabel('League teams').inputValue();
  const draftSlot = await dialog.getByLabel('Your draft slot').inputValue();
  const draftSeed = await dialog.getByLabel('Draft seed').inputValue();
  await dialog.getByRole('button', { name: 'Start mock draft' }).click();
  await page.getByText('Mock active', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Mock draft controls' }).waitFor();
  await capturePage(page, targetDir, 'after');
  return {
    featureId: 'mock.start',
    route: '/draft',
    handle: 'Start mock',
    input: { leagueTeams, draftSlot, draftSeed },
    observedResult: 'Session shows Mock active',
    secondReadOnlyView: 'Settings reopens Mock draft controls',
  };
}

async function driveAssistantNavigation(page, targetDir, input) {
  await loadDraft(page, input.webUrl);
  const primary = page.getByRole('navigation', { name: 'Primary navigation' });
  await capturePage(page, targetDir, 'before');
  await primary.getByRole('button', { name: 'Assistant' }).click();
  await page.waitForURL((url) => url.pathname === '/assistant');
  await page.locator('aside[aria-label="Assistant questions"]').waitFor();
  await page.goto(`${input.webUrl}/assistant`, { waitUntil: 'domcontentloaded' });
  await page.locator('aside[aria-label="Assistant questions"]').waitFor();
  await capturePage(page, targetDir, 'after');
  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('button', { name: 'Draft' }).click();
  await page.waitForURL((url) => url.pathname === '/draft');
  return {
    featureId: 'assistant.header-and-direct-entry',
    route: '/assistant',
    handle: 'Primary navigation > Assistant',
    input: null,
    observedResult: 'Assistant questions is visible through header and direct-route entry',
    secondReadOnlyView: 'Primary navigation > Draft returns to /draft',
  };
}

async function driveRosterSettings(page, targetDir, input) {
  await loadDraft(page, input.webUrl);
  await page.getByRole('button', { name: 'League roster' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Roster requirements' }).waitFor();
  const qb = dialog.getByLabel('QB', { exact: true });
  const beforeValue = Number(await qb.inputValue());
  const nextValue = beforeValue === 10 ? 9 : beforeValue + 1;
  await capturePage(page, targetDir, 'before');
  await qb.fill(String(nextValue));
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'League roster' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Roster requirements' }).waitFor();
  const rereadValue = Number(await dialog.getByLabel('QB', { exact: true }).inputValue());
  if (rereadValue !== nextValue) {
    throw new Error(`QB starter value did not persist in the session: ${String(rereadValue)}.`);
  }
  await capturePage(page, targetDir, 'after');
  await dialog.getByRole('button', { name: 'Reset defaults' }).click();
  return {
    featureId: 'roster.session-persistence',
    route: '/draft',
    handle: 'League roster > QB',
    input: { beforeValue, nextValue },
    observedResult: `QB starter value reread as ${String(rereadValue)}`,
    secondReadOnlyView: 'Closing and reopening Roster requirements preserves the edited field',
  };
}

async function driveSidepanelPreview(page, targetDir, input) {
  await page.setViewportSize({ width: 520, height: 900 });
  await page.goto(`${input.webUrl}/sidepanel`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Fantasy Draft' }).waitFor();
  const nav = page.getByRole('navigation', { name: 'Side panel navigation' });
  await nav.waitFor();
  await capturePage(page, targetDir, 'before');
  await nav.getByRole('button', { name: 'Assistant' }).click();
  await page.getByRole('heading', { name: 'Assistant' }).waitFor();
  await capturePage(page, targetDir, 'after');
  await page.getByRole('button', { name: 'Return to Draft' }).click();
  await page.getByRole('heading', { name: 'Fantasy Draft' }).waitFor();
  return {
    featureId: 'companion.web-route-and-navigation',
    route: '/sidepanel',
    handle: 'Side panel navigation > Assistant',
    input: null,
    observedResult: 'Assistant view appears in the narrow companion',
    secondReadOnlyView: 'Return to Draft restores the Fantasy Draft heading',
  };
}

const scenarioDrivers = {
  'workspace-queue': driveWorkspaceQueue,
  'connection-dialog': driveConnectionDialog,
  'sleeper-provider': driveSleeperProvider,
  'mock-start': driveMockStart,
  'assistant-navigation': driveAssistantNavigation,
  'roster-settings': driveRosterSettings,
  'sidepanel-preview': driveSidepanelPreview,
};

async function drive(runId, scenario, parameters = []) {
  if (!scenarios.has(scenario)) {
    throw new Error(`Unknown scenario ${String(scenario)}. Expected one of: ${[...scenarios].join(', ')}.`);
  }
  let providerInput = {};
  if (scenario === 'sleeper-provider') {
    const sleeperDraft = requireSleeperDraftUrl(parameters[0]);
    providerInput = {
      sleeperDraftUrl: sleeperDraft.url,
      draftId: sleeperDraft.draftId,
      draftSlot: requireDraftSlot(parameters[1]),
    };
  }
  const state = await readJson(statePath(runId));
  const scenarioInput = {
    ...providerInput,
    webUrl: state.webUrl,
    apiUrl: state.apiUrl,
  };
  const doctor = await doctorReport(runId);
  const targetDir = path.join(artifactDir(runId), scenario);
  if (await exists(targetDir)) {
    throw new Error(`Scenario evidence already exists: ${targetDir}`);
  }
  await mkdir(targetDir, { recursive: true });
  await writeJson(path.join(targetDir, 'doctor.json'), doctor);

  const requireFromScripts = createRequire(
    pathToFileURL(path.join(repoRoot, 'scripts', 'package.json'))
  );
  const { chromium } = requireFromScripts('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const consoleEntries = [];
  const networkFailures = [];
  page.on('console', (message) => {
    consoleEntries.push({ type: message.type(), text: message.text() });
  });
  page.on('requestfailed', (request) => {
    networkFailures.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText ?? 'unknown',
    });
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  let action = null;
  let failure = null;
  try {
    action = await scenarioDrivers[scenario](page, targetDir, scenarioInput);
    await writeJson(path.join(targetDir, 'action.json'), {
      ...action,
      scenario,
      capturedAt: new Date().toISOString(),
    });
    await writeJson(path.join(targetDir, 'result.json'), {
      passed: true,
      scenario,
      featureId: action.featureId,
      observedResult: action.observedResult,
      secondReadOnlyView: action.secondReadOnlyView,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    failure = error;
    try {
      await page.screenshot({ path: path.join(targetDir, 'failure.png'), fullPage: true });
      const aria = await page.locator('body').ariaSnapshot();
      await writeFile(path.join(targetDir, 'failure-aria.yml'), `${aria}\n`, 'utf8');
    } catch {
      // Keep the original failure when the page itself can no longer be inspected.
    }
    await writeJson(path.join(targetDir, 'result.json'), {
      passed: false,
      scenario,
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
  } finally {
    await writeJson(path.join(targetDir, 'console.json'), consoleEntries);
    await writeJson(path.join(targetDir, 'network-failures.json'), networkFailures);
    await context.tracing.stop({ path: path.join(targetDir, 'trace.zip') });
    await context.close();
    await browser.close();
  }

  if (failure) throw failure;
  process.stdout.write(`${JSON.stringify({ passed: true, runId, scenario, artifacts: targetDir }, null, 2)}\n`);
}

async function cleanup(runId) {
  const target = runtimeRoot(runId);
  const expectedPrefix = `${runtimeBase}${path.sep}`;
  if (!target.startsWith(expectedPrefix) || path.basename(target) !== requireRunId(runId)) {
    throw new Error(`Refusing unsafe cleanup target: ${target}`);
  }
  const state = await readJson(statePath(runId));
  await terminateGroup(state.pgid, state.processGroupLeader);
  await rm(target, { recursive: true, force: true });

  const remaining = {};
  for (const port of [state.webPort, state.apiPort]) {
    remaining[port] = listenerPids(port);
  }
  const updated = {
    ...state,
    status: 'cleaned',
    cleanedAt: new Date().toISOString(),
    runtimeRemoved: !(await exists(target)),
    remainingPortListeners: remaining,
  };
  await writeJson(statePath(runId), updated);
  process.stdout.write(`${JSON.stringify({
    runId,
    status: 'cleaned',
    runtimeRemoved: updated.runtimeRemoved,
    artifactsPreserved: artifactDir(runId),
    remainingPortListeners: remaining,
  }, null, 2)}\n`);
}

async function main() {
  const [command = 'help', rawRunId, scenario, ...parameters] = process.argv.slice(2);
  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }
  const runId = requireRunId(rawRunId);
  if (command === 'launch') {
    await launch(runId);
    return;
  }
  if (command === 'doctor') {
    await doctor(runId);
    return;
  }
  if (command === 'drive') {
    await drive(runId, scenario, parameters);
    return;
  }
  if (command === 'cleanup') {
    await cleanup(runId);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
