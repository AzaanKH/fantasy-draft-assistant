import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { decodeFantasyProsSnapshot, decodePlayerIdentityFile, decodeKeeperFile, decodeDraftDataRefreshStatus, buildDraftReadinessReport } from '@fantasy-draft/shared/catalog';
import { createQuickMockSettings, evaluateWorkspaceDraftReadiness } from '@fantasy-draft/shared/draft';
import { buildCatalogFixture, planSession, auditReconcileBurst } from './persistence/ui-adapter.mjs';
import { buildReadinessFixture } from './persistence/ui-readiness.mjs';
import { assertNoPreflightWorkload, assertWorkloadAllowed, inspectControl, inspectAssistantMoves, runReconcilePhases, PREFLIGHT_PLAN, PREFLIGHT_SCOPE, evaluateReachability } from './persistence/ui-reachability.mjs';
import { runnerMode } from './persistence/ui-runner-mode.mjs';
import { driverMode, validateReachabilityAuthorization, validateSmokeAuthorization, validatePreflightReceipt } from './persistence/root-smoke-driver.mjs';
import { rootSmokeEvidence } from './persistence/fixtures/root-smoke-evidence.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../web-app/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const now = Date.parse('2026-10-23T20:00:00Z');
const input = await Promise.all(['fantasypros-snapshot', 'player-identity', 'predictions', 'sleeper-adp'].map(async name => JSON.parse(await readFile(new URL(`../demo-data/${name}.json`, import.meta.url), 'utf8'))));
const { snapshot, catalog } = buildCatalogFixture(...input.slice(0, 3));

test('HTTP readiness fixtures preserve real identities and pass production decoders without changing inputs', () => {
  const before = JSON.stringify(input);
  const fixture = buildReadinessFixture({ snapshot, identities: input[1], sleeper: input[3], catalog }, now);
  const ranks = decodeFantasyProsSnapshot(fixture.files['/data/fantasypros-snapshot.json']);
  const identities = decodePlayerIdentityFile(fixture.files['/data/player-identity.json']);
  expect(ranks.metadata).toMatchObject({ sourceType: 'manual-refresh', season: 2026 });
  expect(Date.parse(ranks.metadata.refreshedAt)).toBeLessThanOrEqual(now);
  expect(identities.players).toEqual(input[1].players);
  expect(identities.coverage).toMatchObject({ fantasyProsRankingMatchRate: 1, matchedDefenses: 32 });
  const keepers = decodeKeeperFile(fixture.files['/api/draft-data/current-keepers']);
  expect(keepers.keepers).toHaveLength(10);
  expect(new Set(keepers.keepers.map(row => row.playerId)).size).toBe(10);
  expect(keepers.keepers.every(row => !catalog.slice(0, 300).some(player => player.id === row.playerId))).toBe(true);
  expect(decodeDraftDataRefreshStatus(fixture.files['/api/draft-data/refresh']).state).toBe('idle');
  expect(fixture.files['/api/health'].status).toBe('ok');
  expect(fixture.leaguePreferences).toEqual({ profile: 'quick-mock', quickMock: { totalTeams: 20, totalRounds: 20, reception: 1, passingTouchdown: 4 } });
  expect(createQuickMockSettings(fixture.leaguePreferences.quickMock).keepersEnabled).toBe(false);
  expect(JSON.stringify(input)).toBe(before);
});

test('real product readiness rejects old fixture inputs and accepts fresh controlled data with legitimate quick-mock rules', async () => {
  const fixture = buildReadinessFixture({ snapshot, identities: input[1], sleeper: input[3], catalog }, now);
  const settingsFile = { season: 2026, leagueName: 'Ummati Official', source: 'sleeper', confirmedAt: fixture.timestamp, totalTeams: 10, totalRounds: 14,
    scoring: { passingTouchdown: 4, reception: 1, tightEndReceptionPremium: 0.5, rushAttemptBonus: 0.2 }, roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DEF: 0, BENCH: 5 } };
  const files = { ...fixture.files, '/data/primary-league-settings.json': settingsFile };
  const evaluate = async () => {
    const report = await buildDraftReadinessReport(now, async file => ({ path: file, error: null, value: files[`/${file}`] ?? null }));
    return evaluateWorkspaceDraftReadiness({ sources: Object.fromEntries(report.coreDraftData.map(row => [row.key, { availability: row.status === 'ready' ? 'available' : 'invalid', timestamp: row.timestamp }])),
      warnings: [], leagueSettings: createQuickMockSettings(fixture.leaguePreferences.quickMock, now), totalRounds: 20, useQuickMockSettings: true, demo: false,
      keeperStatus: { isInitialized: true, canonicalCount: 0, duplicateNames: [], invalidAssignments: [], unresolvedNames: [] } }, now);
  };
  expect((await evaluate()).status).toBe('ready');
  files['/data/fantasypros-snapshot.json'] = input[0]; files['/data/player-identity.json'] = input[1];
  expect((await evaluate()).productBlockingFailures.map(row => row.key)).toEqual(expect.arrayContaining(['trusted-rankings', 'canonical-player-identities']));
});

const locator = (document, select) => ({
  async waitFor() { if (!document.querySelector(select)) throw Error('missing control'); },
  async isVisible() { return !!document.querySelector(select) && !document.querySelector(select).hidden; },
  async isEnabled() { return !!document.querySelector(select) && !document.querySelector(select).disabled; },
});
const ctx = document => ({
  getByRole: (role, options) => locator(document, role === 'heading' ? '#rec-queue-heading' : `button[aria-label="${options.name}"]`),
});
test('the real Assistant queue supplies both enabled middle-player move selectors, while blocked UI fails', async () => {
  const source = await readFile(new URL('../web-app/src/features/assistant/AssistantRail.tsx', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('export function AssistantQueue('), source.indexOf('/** Teams picking'));
  const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const compiled = ts.transpileModule(code.replace('export function', 'function'), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const Queue = runInNewContext(`${compiled}; AssistantQueue`, { React, PositionTag: () => null, ChevronUp: () => null, ChevronDown: () => null, X: () => null, survivalPercent: () => null });
  const four = catalog.slice(0, 4);
  const dispatchSource = await readFile(new URL('../web-app/src/workspace/ui-dispatch.ts', import.meta.url), 'utf8');
  const dispatchCode = dispatchSource.slice(dispatchSource.indexOf('export function dispatchWorkspace('), dispatchSource.indexOf('type ResultCommand'));
  const dispatchWorkspace = runInNewContext(`${ts.transpileModule(dispatchCode.replace('export function', 'function'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; dispatchWorkspace`, { STORAGE_ACTIVATION_ENABLED: true });
  const page = await readFile(new URL('../web-app/src/features/assistant/AssistantPage.tsx', import.meta.url), 'utf8');
  const callback = /onMove=\{((?:\(\.\.\.args\).*?))\}\n/.exec(page)[1];
  const sent = [], workspace = { sendDurable: async cmd => { sent.push(cmd); }, send: () => { throw Error('legacy move path'); } };
  const onMove = runInNewContext(`(${callback})`, { STORAGE_ACTIVATION_ENABLED: true, dispatchWorkspace, workspace });
  const props = { queuedPlayerIds: four.map(row => row.id), playerById: new Map(four.map(row => [row.id, row])), recommendationById: new Map(), bestPick: null, mode: 'manual-continuity', provider: 'sleeper', onMove };
  const html = renderToStaticMarkup(React.createElement(Queue, props));
  const proof = await inspectAssistantMoves(ctx(new JSDOM(html).window.document), four[1].name);
  expect(proof.map(row => row.name)).toEqual([`Move ${four[1].name} up in queue`, `Move ${four[1].name} down in queue`]);
  await expect(inspectAssistantMoves(ctx(new JSDOM('<h2>Finish setup to turn on recommendations</h2>').window.document), four[1].name)).rejects.toThrow();
  await expect(inspectAssistantMoves(ctx(new JSDOM(html).window.document), four[0].name)).rejects.toThrow('disabled');
  const buttons = [];
  const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (node.type === 'button') buttons.push(node); visit(node.props.children); };
  visit(Queue(props));
  for (const direction of ['up', 'down']) buttons.find(node => node.props['aria-label'] === `Move ${four[1].name} ${direction} in queue`).props.onClick();
  expect(sent).toEqual([['moveShortlistedPlayer', four[1].id, -1], ['moveShortlistedPlayer', four[1].id, 1]]);
});

test('preflight checks visibility and enablement and rejects any counted workload', async () => {
  await expect(inspectControl({ waitFor: async () => {}, isVisible: async () => true, isEnabled: async () => false }, 'Record')).rejects.toThrow('disabled');
  expect(() => assertNoPreflightWorkload({ commandStarts: [], commandLog: [] })).not.toThrow();
  expect(() => assertWorkloadAllowed(true)).toThrow('cannot issue');
  for (const key of ['commandStarts', 'commandLog']) expect(() => assertNoPreflightWorkload({ commandStarts: [], commandLog: [], [key]: [{}] })).toThrow('zero');
  const mode = runnerMode(['--root-tier2-preflight', '--browser-authorized']);
  expect(mode.rootTier2Preflight).toBe(true);
  expect(Object.values(mode.workload).every(value => value === 0 || value === false)).toBe(true);
  expect(driverMode(['--reachability-only', '--browser-authorized'])).toMatchObject({ preflight: true, scope: 'root-tier2-reachability', marker: 'PREFLIGHT-CLAIM.json' });
  expect(driverMode(['--browser-authorized'])).toMatchObject({ preflight: false, marker: 'SMOKE-CONSUMED.json' });
  for (const other of ['--root-tier2-smoke', '--gate', '--extension-setup-only', '--tier2', '--scenarios=tabs']) expect(() => runnerMode(['--root-tier2-preflight', other])).toThrow();
  expect(PREFLIGHT_PLAN.tabs).toContain('reconcile');
  expect(PREFLIGHT_PLAN['extension-granted']).toContain('slice');
});

test('provider recovery occurs between closed dialogs, with all remaining intents issued honestly', async () => {
  const commands = [0, 1].map(actor => Array.from({ length: 60 }, (_, index) => ({ actor, id: `${actor}:${index}` })));
  const events = []; let recovered = false;
  const issued = await runReconcilePhases(commands, async (rows, actor) => {
    events.push(`batch:${actor}:${rows.length}`);
    return rows.map(cmd => ({ cmd, outcome: recovered ? 'blocked' : 'ack' }));
  }, async count => { events.push(`recovery:${count}`); recovered = true; });
  expect(issued).toHaveLength(120);
  expect(issued.filter(row => row.outcome === 'ack')).toHaveLength(36);
  expect(issued.filter(row => row.outcome === 'blocked')).toHaveLength(84);
  expect(events.slice(0, 3)).toEqual(['batch:0:18', 'batch:1:18', 'recovery:36']);
  let switched = false;
  await expect(runReconcilePhases(commands, async rows => rows.map(cmd => ({ cmd, outcome: 'rejected' })), async () => { switched = true; })).rejects.toThrow('before recovery');
  expect(switched).toBe(false);
});

test.each(['error', 'rejected', 'skipped'])('recovery preserves a real %s outcome and the original auditor rejects it', async outcome => {
  const commands = [0, 1].map(actor => Array.from({ length: 60 }, (_, index) => ({ id: `${actor}:${index}`, slot: actor * 60 + index + 1, playerId: `p${actor * 60 + index + 1}` })));
  let recovered = false, failed = false;
  const issued = await runReconcilePhases(commands, async rows => rows.map(cmd => {
    if (!recovered) return { cmd, outcome: 'ack' };
    if (!failed) { failed = true; return { cmd, outcome, message: 'original visible outcome' }; }
    return { cmd, outcome: 'blocked' };
  }), async () => { recovered = true; });
  const provider = commands.flat().map(cmd => ({ pickNumber: cmd.slot, playerId: cmd.playerId, source: 'sleeper-api' }));
  expect(issued.filter(row => row.outcome === outcome)).toHaveLength(1);
  expect(issued.find(row => row.outcome === outcome).message).toBe('original visible outcome');
  expect(auditReconcileBurst({ issued, committed: { picks: provider }, provider, flippedAt: 36 })).toMatchObject({ good: false, errors: 1, acknowledged: 36, blockedAfterReconcile: 83 });
});

test('preflight permits an unpushed exact commit and rejects dirty, wrong-head or reused output before build authorization', () => {
  const head = '2'.repeat(40), valid = { env: { UI_EXPECTED_HEAD: head, UI_OUTPUT: '/tmp/new-preflight' }, head, upstream: head, branch: 'feat/agent-u11c2-activation', status: '', outputExists: false };
  expect(() => validateReachabilityAuthorization(valid)).not.toThrow();
  expect(() => validateReachabilityAuthorization({ ...valid, upstream: '3'.repeat(40) })).not.toThrow();
  for (const change of [row => row.status = ' M scripts/runner.mjs', row => row.head = '3'.repeat(40), row => row.outputExists = true, row => row.env.UI_OUTPUT = 'relative']) {
    const invalid = structuredClone(valid); change(invalid); expect(() => validateReachabilityAuthorization(invalid)).toThrow();
  }
  expect(() => driverMode(['--reachability-only', '--browser-authorized', '--gate'])).toThrow();
});

async function preflightEvidence() {
  const result = await rootSmokeEvidence();
  result.metadata = { ...result.metadata, tier: PREFLIGHT_SCOPE, smoke: false, commandsPerActor: 0, plan: { sessionCommands: 0 }, config: runnerMode(['--root-tier2-preflight']).workload };
  result.commandStarts = []; result.commandLog = [];
  for (const scenario of result.scenarios) {
    const pick = scenario.pickConflicts[0]; const setup = scenario.panelSetup;
    scenario.runs = []; scenario.pickConflicts = []; scenario.moveConflicts = []; scenario.bursts = {}; delete scenario.lifecycle;
    scenario.reachability = PREFLIGHT_PLAN[scenario.label].map(kind => {
      const control = name => ({ name, visible: true, enabled: true });
      if (kind === 'setup') return { kind, proof: { ...setup, openControl: control('Open local workspace') } };
      if (kind === 'move') return { kind, seedQueue: ['p0', 'p1', 'p2', 'p3'], controls: ['up', 'down', 'up', 'down'].map(dir => control(`Move Player ${dir} in queue`)) };
      if (kind.startsWith('lifecycle')) return { kind, senderSession: '1800000000004', receiverSession: '1800000000005', controls: [control('Add Player to local shortlist'), control('Remove Player from local shortlist')] };
      const commands = pick.results.map(row => structuredClone(row.cmd)), barrier = structuredClone(pick.barrier);
      if (kind === 'slice') { commands[1].slot = 76; barrier[1].slot = '76'; }
      return { kind, commands, barrier, plannedSlice: kind === 'slice' ? { total: 300, perActor: 150 } : undefined,
        controls: [...[0, 1].map(() => control('Record Provisional Pick')), ...(kind === 'slice' ? [control('Add Player0 to local shortlist'), control('Add Player1 to local shortlist')] : [])],
        restoredWithoutDialog: kind === 'reconcile', recovery: { noOpenDialogs: true, manualControlsAbsent: true, committed: { manualContinuityBaselineAt: null, lastConfirmedSyncAt: 1 } } };
    });
  }
  return result;
}

test('reachability raw controls pass independently, but any workload, missing setup or unavailable selector fails', async () => {
  const result = await preflightEvidence();
  expect(evaluateReachability(result)).toMatchObject({ passes: true, consumed: false, workloadCommands: 0, fullMatrixClaim: false, smokeClaim: false, nativeVisibility: 'OPEN' });
  const receipt = { head: result.metadata.expectedHead, scope: PREFLIGHT_SCOPE, consumed: false, sourceStable: true, changed: [],
    reachability: { passes: true, workloadCommands: 0 }, after: { head: result.metadata.expectedHead, status: '' } };
  expect(() => validatePreflightReceipt(receipt, result, result.metadata.expectedHead)).not.toThrow();
  for (const mutate of [
    row => row.commandStarts.push({}), row => row.commandLog.push({}), row => row.scenarios[0].reachability.pop(),
    row => row.scenarios[0].reachability[1].controls[0].enabled = false,
    row => row.scenarios[0].reachability[0].barrier[0].slot = '2',
    row => row.scenarios[0].reachability[2].restoredWithoutDialog = false,
    row => row.scenarios[1].reachability[0].proof.workerReset.after.sentinelPresent = true,
    row => row.scenarios[1].reachability[0].proof.openControl.enabled = false,
    row => row.scenarios[1].reachability[1].plannedSlice.total = 400,
    row => row.scenarios[0].reachability[3].receiverSession = row.scenarios[0].reachability[3].senderSession,
    row => row.scenarios[0].runs.push({}), row => row.metadata.config.perActor = 1, row => row.metadata.commandsPerActor = 150,
    row => row.metadata.productionHttp.readinessFiles['/api/health'] = 'wrong',
    row => row.metadata.gitEnd.status = 'dirty', row => row.gate = { passes: true },
  ]) { const invalid = structuredClone(result); mutate(invalid); expect(evaluateReachability(invalid).passes, mutate.toString()).toBe(false); }
  expect(() => validatePreflightReceipt({ ...receipt, consumed: true }, result, receipt.head)).toThrow();
  expect(() => validatePreflightReceipt(receipt, result, '2'.repeat(40))).toThrow();
});

test.each([false, true])('the actual driver preflight writes only a preflight claim and never consumes smoke, accidental workload=%s', async accidentalWorkload => {
  const result = await preflightEvidence(), head = result.metadata.expectedHead;
  if (accidentalWorkload) result.commandLog.push({ outcome: 'ack' });
  const inputEnv = { UI_EXPECTED_HEAD: head, UI_OUTPUT: '/tmp/offline-only-preflight' };
  const files = new Map([['/repo/source.mjs', 'unchanged']]), commands = [];
  const fakeProcess = { on: () => {}, off: () => {}, exitCode: 0 };
  const source = await readFile(new URL('./persistence/root-smoke-driver.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('export async function runSmokeDriver('), source.indexOf('\nif (process.argv[1]'))
    .replace('export async function', 'async function').replaceAll('import.meta.url', JSON.stringify('file:///repo/scripts/persistence/root-smoke-driver.mjs'));
  const fsWrite = (file, text, options) => { if (options?.flag === 'wx' && files.has(file)) throw Error('duplicate claim'); files.set(file, text); };
  const run = runInNewContext(`${code}; runSmokeDriver`, {
    assert, process: fakeProcess, path, fileURLToPath, createHash, AbortController, driverMode, validateReachabilityAuthorization, validateSmokeAuthorization,
    evaluateReachability, evaluateRootSmoke: () => { throw Error('preflight cannot score smoke'); },
    existsSync: file => files.has(file), mkdirSync: file => fsWrite(file, 'directory', { flag: 'wx' }), readFileSync: file => { if (!files.has(file)) throw Error(`missing ${file}`); return files.get(file); },
    writeFileSync: fsWrite, appendFileSync: (file, text) => files.set(file, files.get(file) + text),
    Processes: { run: async (command, args) => {
      commands.push([command, args]);
      if (command === 'git') return { stdout: args[0] === 'status' ? '' : args[0] === 'branch' ? 'feat/agent-u11c2-activation' : args[0] === 'ls-files' ? 'source.mjs\0' : head };
      if (command === 'node') files.set(path.join(inputEnv.UI_OUTPUT, 'results.json'), JSON.stringify(result));
      return { stdout: '', stderr: '', exitCode: 0 };
    } },
  });
  await run(['--reachability-only', '--browser-authorized'], inputEnv);
  expect(files.has(path.join(inputEnv.UI_OUTPUT, 'PREFLIGHT-CLAIM.json')), files.get(path.join(inputEnv.UI_OUTPUT, 'driver-final-receipt.json'))).toBe(true);
  expect(files.has(path.join(inputEnv.UI_OUTPUT, 'SMOKE-CONSUMED.json'))).toBe(false);
  const final = JSON.parse(files.get(path.join(inputEnv.UI_OUTPUT, 'driver-final-receipt.json')));
  expect(final).toMatchObject({ scope: PREFLIGHT_SCOPE, consumed: false, fullMatrixInvocations: 0, rollbackInvocations: 0 });
  expect(final.reachability.passes).toBe(!accidentalWorkload);
  expect(fakeProcess.exitCode).toBe(accidentalWorkload ? 1 : 0);
  expect(commands.filter(([command]) => command === 'node')[0][1]).toEqual(['scripts/persistence/ui-activation.mjs', '--root-tier2-preflight', '--browser-authorized']);
  expect(commands.filter(([command]) => command === 'pnpm')).toHaveLength(1);
});

test('the actual command recorder refuses preflight before any receipt or DOM operation', async () => {
  const source = await readFile(new URL('./persistence/ui-activation.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function recordAction('), source.indexOf('function runCommand('));
  const result = { commandStarts: [], commandLog: [] };
  const run = runInNewContext(`(${code})`, { results: result, assertWorkloadAllowed, rootTier2Preflight: true });
  await expect(run({}, {}, () => { throw Error('DOM must never run'); })).rejects.toThrow('cannot issue a workload');
  expect(result).toEqual({ commandStarts: [], commandLog: [] });
});

test.each([0, 1])('the actual reachability orchestration inspects every control using declared imported sessions without a workload API, scenario=%s', async index => {
  const original = await rootSmokeEvidence(), result = { progress: [], commandStarts: [], commandLog: [] };
  const source = await readFile(new URL('./persistence/ui-activation.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function reachabilityScenario('), source.indexOf('async function rootSmokeScenario('));
  const actualCatalog = catalog.slice(0, 300), seeded = [], pool = [];
  const control = name => ({ name, visible: true, enabled: true });
  const appTab = { url: () => 'http://localhost:3000/draft', goto: async () => {}, close: async () => {} };
  let queues;
  const run = runInNewContext(`(${code})`, {
    PREFLIGHT_PLAN, FIXTURE_LEAGUE: { profile: 'quick-mock' }, fixtureCatalog: actualCatalog, results: result, assertNoPreflightWorkload, planSession,
    launch: async () => ({ ctx: { newPage: async () => appTab }, runtime: {} }),
    seedV1: async (_page, ids, options) => { queues = options.queues; seeded.push(...ids); },
    activateThroughPrompt: async () => ({ completed: true, v1Snapshot: [] }), loadCatalog: async () => actualCatalog, fixtureRules: async () => {}, appReady: async () => {}, draftUrl: id => `http://localhost:3000/draft?draftId=${id}`,
    startSession: async (_ctx, id) => [0, 1].map(actor => ({ session: id, name: `actor${actor}`, ctx: { getByRole: () => ({ click: async () => {} }) } })),
    inspectAssistantMoves: async (_ctx, name) => ['up', 'down'].map(direction => control(`Move ${name} ${direction} in queue`)),
    readCommitted: async (_ctx, id) => ({ queue: queues[id] }),
    inspectPickControls: async (_actors, commands) => ({ commands, barrier: commands.map(cmd => ({ slot: String(cmd.slot), player: cmd.playerId, visible: true, disabled: false, clicks: [] })), controls: [control('Record Provisional Pick'), control('Record Provisional Pick')] }),
    inspectPoolControl: async (actor, player, queued) => { pool.push({ session: actor.session, id: player.id, queued }); return control(`${queued ? 'Remove' : 'Add'} ${player.name} ${queued ? 'from' : 'to'} local shortlist`); },
    openTab: async (_ctx, id) => ({ session: id }), closeActors: async () => {}, fixture: { healthy: () => {} }, waitForProviderRecovery: async () => ({ noOpenDialogs: true, manualControlsAbsent: true, committed: { manualContinuityBaselineAt: null, lastConfirmedSyncAt: 1 } }),
    installedPanelSetup: async () => ({ ...original.scenarios[1].panelSetup, openControl: control('Open local workspace') }),
    localStorageV1: async () => [], check: (value, message) => { if (!value) throw Error(message); }, save: async () => {},
  });
  const scenario = { label: index ? 'extension-granted' : 'tabs' };
  await run(scenario, index);
  expect(scenario.reachability.map(row => row.kind)).toEqual(PREFLIGHT_PLAN[scenario.label]);
  expect(new Set(seeded).size).toBe(seeded.length);
  expect(seeded.filter(id => id !== '1699999999999').every(id => id.startsWith('180000000'))).toBe(true);
  expect(result.commandStarts).toEqual([]); expect(result.commandLog).toEqual([]);
  if (index) {
    expect(scenario.reachability.find(row => row.kind === 'slice').plannedSlice).toEqual({ total: 300, perActor: 150 });
    expect(pool.map(row => row.id)).toEqual([actualCatalog[150].id, actualCatalog[225].id]);
    expect(scenario.reachability.find(row => row.kind === 'slice').commands.map(cmd => cmd.playerId)).toEqual([actualCatalog[0].id, actualCatalog[75].id]);
  } else expect(pool.map(row => row.queued)).toEqual([false, true, false, true]);
});
