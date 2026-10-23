import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, appendFile, rename, open, mkdir, cp, mkdtemp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { decodeFantasyProsSnapshot, decodePlayerIdentityFile } from '@fantasy-draft/shared/catalog';
import { inspectProductionBuild, createStaticHandler, verifyProductionHttp } from './ui-production.mjs';
import { createDiagnostics, createNavigationGuard } from './ui-diagnostics.mjs';
import { runnerMode } from './ui-runner-mode.mjs';
import { Processes } from '@fantasy-draft/shared/node';
import { fileURLToPath } from 'node:url';
import {
  buildCatalogFixture, DEFAULTS, TOMBSTONE_KEY, DATABASE, SCENARIOS, POSITIVE, TEAMS, ROUNDS, lcg, parseCatalogOption, selectCatalog, slotInfo,
  planSession, assertPlan, draftIds, auditSession, auditPickConflict, auditMoveConflict, auditReconcileBurst, auditBlocked, evaluateUiGate, evaluateTier2, sessionPasses, auditMockBurst,
} from './ui-adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const { extensionSetupOnly, workload } = runnerMode(args);
const flag = name => args.includes(`--${name}`);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const int = (name, fallback) => { const value = process.env[name] === undefined ? fallback : Number(process.env[name]); if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`); return value; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(operation, ms, label) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  })]); } finally { clearTimeout(timer); }
}
const tier2 = flag('tier2');
const focused = flag('focused-navigation');
const prepareProduction = flag('prepare-production');
const offline = flag('plan') || flag('fixture-check') || prepareProduction;

const UI = {
  activation: '[data-storage-activation="review"]',
  blocked: '[data-storage-blocked]',
  closedBox: /I have closed other draft tabs and side panels/i,
  activate: 'Activate IndexedDB',
  workspaceNav: 'Draft workspace',
  enterManual: 'Enter Manual Continuity',
  addProvisional: 'Add Provisional Pick',
  record: 'Record Provisional Pick',
  openLocal: /Open local workspace/i,
  search: 'Search player or team',
  saving: /^Saving \d+ draft change/,
  notSaved: /Draft change was not saved/,
};

const config = {
  suites: int('UI_SUITES', tier2 || focused ? 1 : DEFAULTS.suites), seeds: int('UI_SEEDS', tier2 || focused ? 1 : DEFAULTS.seeds), perActor: int('UI_COMMANDS_PER_ACTOR', DEFAULTS.perActor),
  pickConflicts: int('UI_PICK_CONFLICTS', focused ? 0 : DEFAULTS.pickConflicts), moveConflicts: int('UI_MOVE_CONFLICTS', focused ? 0 : tier2 ? 20 : DEFAULTS.moveConflicts),
  bursts: int('UI_BURSTS', focused ? 0 : 1) === 1, control: int('UI_CONTROL', tier2 || focused ? 0 : 1) === 1, lifecycle: int('UI_LIFECYCLE', focused ? 0 : 1) === 1,
  burstPicksPerActor: int('UI_BURST_PICKS', 60), headed: process.env.UI_HEADED === 'true' || process.env.PERSISTENCE_HEADED === 'true',
  commandIntervalMs: focused ? 6000 : 0,
  port: 3000, executable: process.env.UI_EXECUTABLE || process.env.PERSISTENCE_EXECUTABLE,
  ...workload,
};
const smoke = flag('smoke') || config.suites !== DEFAULTS.suites || config.seeds !== DEFAULTS.seeds || config.perActor !== DEFAULTS.perActor ||
  config.pickConflicts < DEFAULTS.pickConflicts || config.moveConflicts < DEFAULTS.moveConflicts || !config.bursts;
const scenarioArg = option('scenarios') ?? process.env.UI_SCENARIOS;
if (extensionSetupOnly && scenarioArg) throw new Error('Setup-only cannot select workload scenarios');
const selected = offline || extensionSetupOnly ? [] : focused ? ['tabs'] : scenarioArg ? scenarioArg.split(',').map(s => s.trim()) : SCENARIOS;
if (new Set(selected).size !== selected.length || selected.some(s => !SCENARIOS.includes(s))) throw new Error('Unknown scenario');
const outDir = path.resolve(process.env.UI_OUTPUT || '/Users/azaankhalfe/Desktop/fantasy-draft/artifacts/agent-friendly-plan/units/u11c2/ui-proof');

if (flag('check')) {
  const file = args[args.indexOf('--check') + 1];
  const gate = evaluateUiGate(JSON.parse(await readFile(file, 'utf8')));
  console.log(JSON.stringify(gate, null, 2)); process.exit(gate.passes ? 0 : 1);
}

if (!offline && !flag('browser-authorized')) throw new Error('Browser paused: pass --browser-authorized only after the parent confirms fixes are ready');
if (!offline && !flag('smoke') && !tier2 && !flag('gate') && !focused && !extensionSetupOnly) throw new Error('Choose --tier2, --smoke, --gate or --extension-setup-only explicitly');
if (tier2 && (config.suites !== 1 || config.seeds !== 1 || config.perActor !== 300 || config.pickConflicts !== 20 || config.moveConflicts !== 20 || config.control)) {
  throw new Error('Tier 2 requires 1 suite, 1 seed, 300 commands per actor, 20 pick conflicts, 20 moves, no sequential control');
}
async function git() {
  const [head, branch, status] = await Promise.all([
    ['rev-parse', 'HEAD'], ['branch', '--show-current'], ['status', '--porcelain', '--untracked-files=normal'],
  ].map(args => Processes.run('git', args, { cwd: root, timeoutMs: 30000, maxOutputBytes: 1000000 })));
  return { head: head.stdout.trim(), branch: branch.stdout.trim(), status: status.stdout.trim() };
}
const gitStart = await git(); gitStart.clean = !gitStart.status;
if (gitStart.branch !== 'feat/agent-u11c2-activation') throw new Error('Wrong branch for U11C2 browser proof');
if (flag('gate') && (!process.env.UI_EXPECTED_HEAD || process.env.UI_EXPECTED_HEAD !== gitStart.head || !gitStart.clean || smoke)) {
  throw new Error('Final matrix requires UI_EXPECTED_HEAD equal to the clean committed HEAD and the complete default matrix');
}
if (extensionSetupOnly && (!process.env.UI_EXPECTED_HEAD || process.env.UI_EXPECTED_HEAD !== gitStart.head || !gitStart.clean)) {
  throw new Error('Setup-only requires UI_EXPECTED_HEAD equal to the clean committed HEAD');
}

delete process.env.VITE_PERSISTENCE_HARNESS;
delete process.env.VITE_DEMO_MODE;
process.env.VITE_STORAGE_ACTIVATION = 'idb';
process.env.BROWSER_DATA_SOURCE = 'demo';

const requireScripts = createRequire(path.join(root, 'scripts/package.json'));
const requireWeb = createRequire(path.join(root, 'web-app/package.json'));
const { chromium } = requireScripts('playwright');
const requirePlaywright = createRequire(requireScripts.resolve('playwright'));
const coreRoot = path.dirname(requirePlaywright.resolve('playwright-core/package.json'));
const { chromiumSwitches } = requirePlaywright(path.join(coreRoot, 'lib/server/chromium/chromiumSwitches.js'));
const { createServer, createLogger, build } = await import(requireWeb.resolve('vite'));
const origin = `http://localhost:${config.port}`;
await mkdir(outDir, { recursive: true });
let stopNavigation;
const navigationStopped = new Promise(resolve => { stopNavigation = resolve; });
const navigation = !offline && !focused ? createNavigationGuard({ origin, onDefect: defect => {
  results.productionNavigationDefect = defect;
  stopNavigation(defect);
} }) : undefined;
const diagnostics = createDiagnostics(outDir, { navigation });
const guarded = operation => navigation ? Promise.race([operation(), navigationStopped.then(defect => { throw new Error(defect.message); })]) : operation();
const claim = await open(path.join(outDir, 'run-claim.json'), 'wx');
await claim.writeFile(JSON.stringify({ started: new Date().toISOString(), pid: process.pid, args, head: gitStart.head }));
await claim.close();

const results = { metadata: { started: new Date().toISOString(), root, node: process.version, smoke, tier: offline ? 'offline' : extensionSetupOnly ? 'extension-setup-only' : focused ? 'focused-navigation' : tier2 ? 2 : flag('gate') ? 3 : 'exploratory', git: gitStart, expectedHead: process.env.UI_EXPECTED_HEAD, serve: focused ? 'vite-dev' : 'production-static',
  suites: config.suites, seeds: config.seeds, commandsPerActor: config.perActor, config, origin, scenarios: selected,
  env: { VITE_STORAGE_ACTIVATION: process.env.VITE_STORAGE_ACTIVATION, VITE_PERSISTENCE_HARNESS: process.env.VITE_PERSISTENCE_HARNESS, VITE_DEMO_MODE: process.env.VITE_DEMO_MODE, BROWSER_DATA_SOURCE: process.env.BROWSER_DATA_SOURCE },
  workload: extensionSetupOnly ? 'setup only; zero pick or queue commands; no full matrix claim' : 'real DOM: Provisional Pick dialog + pool queue buttons; P9 LCG 0..5ms jitter' },
  commandStarts: [], commandLog: [], cleanupErrors: [], failureEvidence: [], progress: [], scenarios: [], pageErrors: [], blockedRequests: [], navigations: [], scenarioErrors: [] };
async function browserDataFallbackFiles() {
  const manifest = await readFile(path.join(root, 'shared/src/catalog/manifest.ts'), 'utf8');
  return [...manifest.matchAll(/file\('([^']+)', '(all|local)'/g)].map(([, name]) => `data/${name}.json`);
}
async function sourceSnapshot() {
  const files = ['scripts/persistence/ui-activation.mjs', 'scripts/persistence/ui-adapter.mjs', 'pnpm-lock.yaml',
    'scripts/persistence/ui-diagnostics.mjs', 'scripts/persistence/ui-production.mjs', 'scripts/persistence/ui-seed.mjs', 'scripts/persistence/ui-runner-mode.mjs', 'scripts/ui-production.test.mjs', 'scripts/ui-audit.test.mjs', 'scripts/ui-runner.test.mjs', 'scripts/persistence/fixtures/mock-player-controls.html',
    'package.json', 'pnpm-workspace.yaml', 'source-condition.js', '.npmrc'];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(path.join(root, dir), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') { files.push(`${dir}/<absent>`); return; } throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files.push(file);
    }
  }
  for (const dir of ['web-app/src', 'shared/src', 'extension/src', 'server/src', 'demo-data',
    'shared/dist', 'web-app/dist', 'extension/dist']) await walk(dir);
  for (const workspace of ['web-app', 'shared', 'extension', 'server']) {
    for (const entry of await readdir(path.join(root, workspace), { withFileTypes: true })) {
      if (entry.isFile() && (/\.(json|[cm]?js|ts|html)$/.test(entry.name) || entry.name.startsWith('.env'))) files.push(path.join(workspace, entry.name));
    }
  }
  files.push(...await browserDataFallbackFiles());
  return Object.fromEntries(await Promise.all([...new Set(files)].sort().map(async file => {
    try { return [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')]; }
    catch (error) { if (error.code === 'ENOENT') return [file, null]; throw error; }
  })));
}
results.metadata.sourceHashes = await sourceSnapshot();
let saveTail = Promise.resolve();
function save() {
  saveTail = saveTail.then(async () => {
    const target = path.join(outDir, 'results.json');
    await writeFile(`${target}.tmp`, JSON.stringify(results, null, 2));
    await rename(`${target}.tmp`, target);
  });
  return saveTail;
}
let receiptTail = Promise.resolve();
function journal(event) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n';
  receiptTail = receiptTail.then(() => appendFile(path.join(outDir, 'command-receipts.ndjson'), line));
  return receiptTail;
}

const fixture = createFixture();
function createFixture() {
  const drafts = new Map();
  let catalogBytes;
  const state = id => { if (!drafts.has(id)) drafts.set(id, { mode: 'healthy', picks: [], syncedAt: Date.now(), streams: new Set(), held: new Set(), timer: null }); return drafts.get(id); };
  const metadata = id => ({ provider: 'sleeper', draftId: id, providerKey: `sleeper:${id}`, status: 'drafting', type: 'linear',
    settings: { teams: TEAMS, rounds: ROUNDS, pickTimer: 0 }, draftOrder: null });
  const snapshot = id => {
    const s = state(id); const now = Date.now();
    if (s.mode === 'healthy') s.syncedAt = now;
    return { provider: 'sleeper', draftId: id, draft: metadata(id), picks: s.picks.map(p => ({ ...p, draftId: id })), status: 'synced', lastPolledAt: now, lastSuccessfulSyncAt: s.syncedAt, lastError: null };
  };
  const open = (id, res) => {
    const s = state(id);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`retry: 1000\ndata: ${JSON.stringify({ type: 'snapshot', snapshot: snapshot(id) })}\n\n`);
    s.streams.add(res); res.on('close', () => s.streams.delete(res));
    s.timer ??= setInterval(() => {
      for (const stream of s.streams) stream.write(`data: ${JSON.stringify({ type: 'heartbeat', provider: 'sleeper', draftId: id, lastPolledAt: Date.now(), lastSuccessfulSyncAt: s.syncedAt })}\n\n`);
    }, 1000);
  };
  return {
    catalog(bytes) { catalogBytes = bytes; },
    stop() { for (const s of drafts.values()) { clearInterval(s.timer); for (const stream of [...s.streams, ...s.held]) stream.destroy(); } },
    outage(id) { const s = state(id); s.mode = 'outage'; for (const stream of s.streams) stream.destroy(); s.streams.clear(); },
    healthy(id, picks) {
      const s = state(id); if (picks) s.picks = picks; s.mode = 'healthy';
      for (const held of [...s.held]) { s.held.delete(held); open(id, held); }
      for (const stream of s.streams) stream.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: snapshot(id) })}\n\n`);
    },
    handler(request, response, next) {
      const url = new URL(request.url ?? '/', 'http://fixture.local');
      if (catalogBytes && url.pathname === '/data/fantasypros-snapshot.json') { response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(catalogBytes); return; }
      if (url.pathname === '/__ui-fixture/blank') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>fixture</title><main>blank</main>'); return; }
      const match = /^\/api\/sync\/sleeper\/drafts\/([^/]+)(\/refresh|\/events)?$/.exec(url.pathname);
      if (url.pathname.startsWith('/api/') && !match) { response.statusCode = 503; response.setHeader('Content-Type', 'application/json'); response.end('{"error":"offline fixture"}'); return; }
      if (!match) { next(); return; }
      const id = decodeURIComponent(match[1]);
      if (match[2] === '/events') {
        const s = state(id);
        if (s.mode === 'outage') { s.held.add(response); request.on('close', () => s.held.delete(response)); return; }
        open(id, response); return;
      }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(snapshot(id)));
    },
  };
}

let server; let context; let currentLabel = '';
const pageSessions = new WeakMap();
const pageErrors = results.pageErrors;

function check(condition, message) { if (results.productionNavigationDefect) throw new Error(results.productionNavigationDefect.message); if (!condition) throw new Error(message); }

async function prepareCatalogFixture() {
  const sourceNames = ['fantasypros-snapshot.json', 'player-identity.json', 'predictions.json'];
  const sources = await Promise.all(sourceNames.map(async name => {
    const bytes = await readFile(path.join(root, 'demo-data', name), 'utf8');
    return { name: `demo-data/${name}`, sha256: createHash('sha256').update(bytes).digest('hex'), data: JSON.parse(bytes) };
  }));
  const [original, identityInput, predictions] = sources.map(row => row.data);
  decodeFantasyProsSnapshot(original);
  const identities = decodePlayerIdentityFile(identityInput);
  const originalCount = original.rankings.length;
  const { snapshot, catalog } = buildCatalogFixture(original, identities, predictions);
  const decoded = decodeFantasyProsSnapshot(snapshot);
  check(catalog.length === 900, `Expected 900 real identities, got ${catalog.length}`);
  const plan = extensionSetupOnly ? { actors: [[], []], picks: [], queue: [] } : planSession(selectCatalog(catalog, config.perActor * 2), config.perActor);
  const problems = extensionSetupOnly ? [] : assertPlan(plan);
  check(!problems.length, `Catalog plan invalid: ${problems.join(', ')}`);
  results.metadata.plan = { perActor: config.perActor, sessionCommands: plan.actors.flat().length,
    picks: plan.picks.length, queue: plan.queue.length, scenarioCommands: config.suites * config.seeds * config.perActor * 2,
    actorSlots: extensionSetupOnly ? [] : plan.actors.map(rows => { const picks = rows.filter(c => c.type === 'pick'); return [picks[0].slot, picks.at(-1).slot]; }), problems };
  const bytes = JSON.stringify(snapshot);
  fixture.catalog(bytes);
  results.metadata.catalogFixture = { path: '/data/fantasypros-snapshot.json', originalCount, rankingCount: decoded.rankings.length, identityCount: catalog.length,
    sources: sources.map(({ name, sha256 }) => ({ name, sha256 })), sha256: createHash('sha256').update(bytes).digest('hex'),
    schema: 'decodeFantasyProsSnapshot', schemaDecoded: true, normalBrowserHttpDecode: true,
    note: 'Ranking order and missing projections are controlled test data; names and canonical/Sleeper identities are real installed demo records.' };
  await writeFile(path.join(outDir, 'catalog-fixture.json'), bytes);
  await writeFile(path.join(outDir, 'catalog-identities.json'), JSON.stringify(catalog, null, 2));
}

async function launch(label, { extensionDir } = {}) {
  const extension = extensionDir ?? path.join(root, 'extension/dist');
  const defaultFeatures = chromiumSwitches(false, 'chromium', false).filter(arg => arg.startsWith('--disable-features='));
  const features = defaultFeatures.map(arg => '--disable-features=' + arg.slice('--disable-features='.length).split(',').filter(name => name !== 'ThirdPartyStoragePartitioning').join(','));
  const launchOptions = { timeout: 30000, channel: 'chromium', headless: !config.headed, viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions', ...defaultFeatures], args: [...features, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    ...(config.executable ? { executablePath: config.executable } : {}) };
  const profile = await mkdtemp(path.join(outDir, `profile-${label}-`));
  const ctx = await chromium.launchPersistentContext(profile, launchOptions);
  context = ctx;
  ctx.setDefaultTimeout(15000);
  ctx.setDefaultNavigationTimeout(30000);
  ctx.on('page', page => {
    diagnostics.attach(page, ctx, label).catch(error => results.pageErrors.push({ label, message: `diagnostics: ${error.message}` }));
    page.on('pageerror', error => pageErrors.push({ label, url: page.url(), message: error.message }));
    page.on('framenavigated', frame => results.navigations.push({ label, at: new Date().toISOString(), url: frame.url() }));
  });
  await ctx.route('**/*', route => {
    if (navigation?.failure()) return route.abort();
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname) || ['chrome-extension:', 'data:', 'about:', 'blob:'].includes(url.protocol)) return route.continue();
    results.blockedRequests.push(url.origin); return route.abort();
  });
  const newPage = ctx.newPage.bind(ctx);
  ctx.newPage = async () => {
    const page = await newPage(); await diagnostics.attach(page, ctx, label);
    if (navigation) {
      const goto = page.goto.bind(page); const reload = page.reload.bind(page);
      page.goto = (url, options) => navigation.navigate(page, 'runner goto', url, () => goto(url, options));
      page.reload = options => navigation.navigate(page, 'runner reload', page.url(), () => reload(options));
    }
    return page;
  };
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  const id = new URL(worker.url()).hostname;
  await worker.evaluate(() => chrome.storage.local.set({ syncToken: 'persistence-demo-fixture-no-provider-connection' }));
  const runtime = await worker.evaluate(async () => ({ manifest: chrome.runtime.getManifest(), permissions: await chrome.permissions.getAll(), userAgent: navigator.userAgent }));
  const probe = await ctx.newCDPSession(ctx.pages()[0] ?? await ctx.newPage());
  const argv = await probe.send('Browser.getBrowserCommandLine'); await probe.detach();
  if (argv.arguments.some(arg => arg.startsWith('--disable-features=') && arg.includes('ThirdPartyStoragePartitioning'))) throw new Error('Browser disabled storage partitioning');
  return { ctx, worker, extensionId: id, runtime, launchOptions, profile };
}

const draftUrl = (id, host = 'localhost') => `http://${host}:${config.port}/draft?provider=sleeper&draftId=${id}&position=1`;
const header = ctx => ctx.getByRole('button', { name: UI.workspaceNav, exact: true });

async function appState(ctx, timeout = 60000) {
  const target = header(ctx).or(ctx.locator(`${UI.activation}, ${UI.blocked}`)).first();
  await target.waitFor({ timeout });
  if (await header(ctx).count()) return 'app';
  if (await ctx.locator(UI.blocked).count()) return 'blocked';
  return 'activation';
}
async function appReady(ctx, what) {
  const state = await appState(ctx);
  if (state !== 'app') throw new Error(`${what}: expected the app, saw ${state}${state === 'blocked' ? ` (${await ctx.locator(UI.blocked).first().innerText()})` : ''}`);
}
async function drained(ctx, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!(await ctx.getByText(UI.saving).first().isVisible())) {
      await sleep(50);
      if (!(await ctx.getByText(UI.saving).first().isVisible())) return;
    }
    await sleep(50);
  }
  throw new Error('Command notice stayed pending');
}
async function notSavedVisible(ctx) { return (await ctx.getByText(UI.notSaved).count()) > 0; }
async function localStorageV1(page) {
  return page.evaluate(([tombstone]) => Object.keys(localStorage).filter(k => k.startsWith('fantasy-draft-session') || k === tombstone || k.startsWith('fantasy-draft-sync')).sort().map(k => [k, localStorage.getItem(k)]), [TOMBSTONE_KEY]);
}
const sessionRows = entries => entries.filter(([k]) => k.startsWith('fantasy-draft-session'));

async function readCommitted(page, id) {
  return bounded(() => page.evaluate(async ([database, key]) => {
    if (!(await indexedDB.databases()).some(row => row.name === database)) throw new Error('Audit requires an existing database');
    const db = await new Promise((resolve, reject) => {
      let done = false; const finish = error => { if (done) return; done = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => finish(new Error('Read-only IDB open timed out')), 5000);
      const r = indexedDB.open(database); r.onblocked = () => finish(new Error('Read-only IDB open blocked'));
      r.onsuccess = () => { if (done) { r.result.close(); return; } done = true; clearTimeout(timer); resolve(r.result); };
      r.onerror = () => finish(r.error);
    });
    try {
      const session = await new Promise((resolve, reject) => { const g = db.transaction(['sessions'], 'readonly').objectStore('sessions').get(key); g.onsuccess = () => resolve(g.result ?? null); g.onerror = () => reject(g.error); });
      if (!session) return { present: false, picks: [], queue: [] };
      return { present: true, revision: session.revision, picks: (session.draftHistory ?? []).map(p => ({ pickNumber: p.pickNumber, playerId: p.playerId, source: p.source })), queue: session.shortlistedPlayerIds ?? [], sessionMode: session.sessionMode };
    } finally { db.close(); }
  }, [DATABASE, `sleeper:${id}`]), 10000, 'Read-only committed session audit');
}
async function countSessions(page) {
  return bounded(() => page.evaluate(async ([database]) => {
    const names = (await indexedDB.databases()).map(d => d.name);
    if (!names.includes(database)) return { databases: names, sessions: null };
    if (!(await indexedDB.databases()).some(row => row.name === database)) throw new Error('Audit requires an existing database');
    const db = await new Promise((resolve, reject) => {
      let done = false; const finish = error => { if (done) return; done = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => finish(new Error('Read-only IDB open timed out')), 5000);
      const r = indexedDB.open(database); r.onblocked = () => finish(new Error('Read-only IDB open blocked'));
      r.onsuccess = () => { if (done) { r.result.close(); return; } done = true; clearTimeout(timer); resolve(r.result); };
      r.onerror = () => finish(r.error);
    });
    try { const keys = await new Promise((resolve, reject) => { const g = db.transaction(['sessions'], 'readonly').objectStore('sessions').getAllKeys(); g.onsuccess = () => resolve(g.result); g.onerror = () => reject(g.error); }); return { databases: names, sessions: keys.length }; }
    finally { db.close(); }
  }, [DATABASE]), 10000, 'Read-only session count');
}

let seedSequence = 0;
async function seedV1(page, ids) {
  const prefix = `v1-seed-${++seedSequence}`;
  const input = path.join(outDir, `${prefix}-input.json`);
  const output = path.join(outDir, `${prefix}-entries.json`);
  await writeFile(input, JSON.stringify({ ids, teams: TEAMS, rounds: ROUNDS, output }), { flag: 'wx' });
  await Processes.run(process.execPath, ['--conditions=@fantasy-draft/source', requireScripts.resolve('tsx/cli'), path.join(here, 'ui-seed.mjs'), input],
    { cwd: root, timeoutMs: 30000 });
  const entries = JSON.parse(await readFile(output, 'utf8'));
  await page.goto(`${origin}/__ui-fixture/blank`);
  return page.evaluate(entries => { for (const [key, value] of entries) localStorage.setItem(key, value); return entries.length; }, entries);
}

async function activateThroughPrompt(page, seededIds) {
  const record = { completed: false };
  const started = Date.now();
  await page.goto(`${origin}/draft`);
  check(await appState(page, 60000) === 'activation', 'Activation prompt did not appear on a profile with v1 data');
  await page.getByRole('heading', { name: 'Draft storage setup' }).waitFor();
  record.readOnlyBeforeConfirm = await page.getByRole('region', { name: 'Saved drafts, read only' }).isVisible();
  const before = await localStorageV1(page);
  record.tombstoneBefore = before.some(([k]) => k === TOMBSTONE_KEY);
  record.seededSessionsVisible = sessionRows(before).length;
  record.blockers = await page.locator('section[aria-label^="Reconcile"]').count();
  const idb = await countSessions(page);
  record.idbSessionsBefore = idb.sessions;
  check(!record.tombstoneBefore, 'Tombstone existed before confirmation');
  check(record.blockers === 0, `Unexpected reconciliation blockers: ${record.blockers}`);
  check(!idb.sessions, `IndexedDB held ${idb.sessions} sessions before confirmation`);
  const button = page.getByRole('button', { name: UI.activate });
  record.buttonDisabledBeforeCheckbox = await button.isDisabled();
  await page.getByLabel(UI.closedBox).check();
  await waitFor(async () => !(await button.isDisabled()), 60000, 'Activation preflight did not enable confirmation');
  check(!(await button.isDisabled()), 'Activate IndexedDB stayed disabled after the checkbox (preflight not ready)');
  await button.click();
  await header(page).waitFor({ timeout: 60000 });
  record.elapsedMs = Date.now() - started;
  const after = await localStorageV1(page);
  record.tombstoneAfter = after.some(([k]) => k === TOMBSTONE_KEY);
  record.tombstone = after.find(([k]) => k === TOMBSTONE_KEY)?.[1] ?? null;
  record.v1RetainedByteIdentical = JSON.stringify(sessionRows(after)) === JSON.stringify(sessionRows(before));
  const idbAfter = await countSessions(page);
  record.idbSessionsAfter = idbAfter.sessions;
  record.importedAll = idbAfter.sessions === seededIds.length;
  record.completed = record.tombstoneAfter && record.importedAll;
  record.v1Snapshot = after;
  return record;
}

async function ensurePool(ctx) {
  const search = ctx.getByPlaceholder(UI.search);
  if (await search.isVisible().catch(() => false)) return search;
  const expand = ctx.getByRole('button', { name: 'Expand player workspace' });
  if (await expand.isVisible().catch(() => false)) await expand.click();
  const players = ctx.getByRole('tab', { name: /^Players/ });
  if (await players.isVisible().catch(() => false)) await players.click();
  await search.waitFor({ timeout: 15000 });
  return search;
}
async function queueNames(ctx, expectedCount) {
  await ctx.getByRole('tab', { name: /^Queue/ }).click();
  const rows = ctx.locator('.draft-queue-row .draft-pool-name');
  if (expectedCount !== undefined) await waitFor(async () => (await rows.allInnerTexts()).length === expectedCount, 20000, `Queue did not hydrate ${expectedCount} acknowledged entries`);
  return rows.allInnerTexts();
}
async function readProvisionalPicks(actor, nameToId, expectedCount) {
  const items = actor.ctx.getByRole('list', { name: 'Provisional Picks', exact: true }).getByRole('listitem');
  if (expectedCount !== undefined) await waitFor(async () => await items.count() === expectedCount, 20000, `Provisional list did not hydrate ${expectedCount} acknowledged picks`);
  const rows = await actor.ctx.getByRole('list', { name: 'Provisional Picks', exact: true }).getByRole('listitem').evaluateAll(items =>
    items.map(item => ({ label: item.getAttribute('aria-label') ?? '', text: item.textContent ?? '' })));
  return rows.map(row => {
    const name = row.label.split(', ')[0];
    const playerId = nameToId.get(name);
    const pickNumber = Number(/ · #(\d+)/.exec(row.text)?.[1]);
    if (!playerId || !pickNumber) throw new Error(`Cannot decode provisional DOM row: ${row.label}`);
    return { playerId, pickNumber };
  });
}
async function readQueueIds(actor, nameToId, expectedCount) {
  const names = await queueNames(actor.ctx, expectedCount);
  const unknown = names.filter(n => !nameToId.has(n));
  if (unknown.length) throw new Error(`Queue shows names outside the catalog: ${unknown.slice(0, 3)}`);
  return names.map(n => nameToId.get(n));
}

async function openPickDialog(ctx) {
  const add = ctx.getByRole('button', { name: UI.addProvisional });
  await add.click();
  const dialog = ctx.getByRole('dialog');
  await dialog.waitFor();
  return dialog;
}
async function fillPick(dialog, cmd) {
  await dialog.getByLabel('Observed player').selectOption({ value: cmd.playerId });
  await dialog.getByLabel('Team and draft position').selectOption({ value: String(cmd.slot) });
}
async function awaitDialogOutcome(dialog, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!(await dialog.isVisible().catch(() => false))) return { outcome: 'ack' };
    const alert = dialog.getByRole('alert');
    if (await alert.count()) {
      const text = (await alert.first().innerText()).trim();
      return { outcome: 'rejected', alert: text };
    }
    await sleep(20);
  }
  return { outcome: 'error', message: 'Dialog neither closed nor showed an error' };
}
async function uiPick(actor, cmd) {
  const ctx = actor.ctx;
  if (!(await ctx.getByRole('button', { name: UI.addProvisional }).count())) return { outcome: 'blocked', message: 'Manual continuity control is not offered' };
  const dialog = await openPickDialog(ctx);
  await fillPick(dialog, cmd);
  await dialog.getByRole('button', { name: UI.record, exact: true }).click();
  return awaitDialogOutcome(dialog);
}
async function uiQueueAdd(actor, cmd) {
  const ctx = actor.ctx;
  const search = await ensurePool(ctx);
  await search.fill(cmd.name);
  await ctx.getByRole('button', { name: `Add ${cmd.name} to local shortlist`, exact: true }).click();
  await ctx.getByRole('button', { name: `Remove ${cmd.name} from local shortlist`, exact: true }).waitFor({ timeout: 20000 });
  await drained(ctx);
  return { outcome: 'ack' };
}
async function failureEvidence(actor, row) {
  const prefix = `failure-${String(results.failureEvidence.length + 1).padStart(4, '0')}`;
  const record = { actionId: row.actionId, prefix, url: actor.page.url(), errors: [] };
  results.failureEvidence.push(record);
  for (const [suffix, operation] of [
    ['html', async () => writeFile(path.join(outDir, `${prefix}.html`), await actor.ctx.content())],
    ['png', () => actor.page.screenshot({ path: path.join(outDir, `${prefix}.png`), timeout: 5000 })],
    ['audit.json', async () => {
      const audit = { row, sourceHashes: await sourceSnapshot(), pageErrors: results.pageErrors, errors: [] };
      for (const [key, read] of [['v1', () => localStorageV1(actor.page)],
        ['committed', () => { const id = actor.session ?? pageSessions.get(actor.page); return id ? readCommitted(actor.page, id) : null; }]]) {
        try { audit[key] = await read(); } catch (error) { audit.errors.push(`${key}: ${error.message}`); }
      }
      await writeFile(path.join(outDir, `${prefix}-audit.json`), JSON.stringify(audit, null, 2));
    }],
  ]) {
    try { await bounded(operation, 10000, `capture ${suffix}`); } catch (error) { record.errors.push(`${suffix}: ${error.message}`); }
  }
}
async function dismissFailedDialog(ctx) {
  const dialog = ctx.getByRole('dialog');
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click({ timeout: 3000 }).catch(() => undefined);
    await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined);
  }
}
async function recordAction(actor, cmd, operation) {
  check(!results.productionNavigationDefect, 'Production navigation stopped the workload');
  const startedAt = Date.now();
  const actionId = `${currentLabel}/${actor.session ?? 'mock'}/${cmd.id}`;
  const start = { actionId, scenario: currentLabel, session: actor.session, cmd, actor: actor.name, startedAt };
  results.commandStarts.push(start);
  await journal({ phase: 'started', ...start });
  let row;
  try {
    const documentStarted = await bounded(() => actor.ctx.evaluate(() => performance.timeOrigin), 5000, 'read action document');
    const result = await bounded(operation, 45000, `DOM command ${actionId}`);
    if (await bounded(() => actor.ctx.evaluate(() => performance.timeOrigin), 5000, 'confirm action document') !== documentStarted) throw new Error('Production document replaced during command');
    row = { ...start, ...result, documentStarted, ms: Date.now() - startedAt };
  }
  catch (error) { row = { ...start, outcome: 'error', message: error.message, ms: Date.now() - startedAt }; }
  results.commandLog.push(row);
  await journal({ phase: 'finished', ...row });
  if (row.outcome !== 'ack') {
    await failureEvidence(actor, row);
    await dismissFailedDialog(actor.ctx);
  }
  console.log(JSON.stringify({ actionId, outcome: row.outcome, ms: row.ms, message: row.message, alert: row.alert }));
  await save();
  return row;
}
function runCommand(actor, cmd) {
  return recordAction(actor, cmd, () => cmd.type === 'pick' ? uiPick(actor, cmd) : uiQueueAdd(actor, cmd));
}
async function runActor(actor, commands, seed, observer, stop = { failed: false }) {
  const random = lcg(seed); const issued = [];
  for (const cmd of commands) {
    if (stop.failed) break;
    if (config.commandIntervalMs) await sleep(Math.max(0, actor.pacingStarted + issued.length * config.commandIntervalMs - Date.now()));
    await sleep(Math.floor(random() * 6));
    const row = await runCommand(actor, cmd);
    issued.push(row); observer?.(row);
    if (['error', 'rejected'].includes(row.outcome) || (row.outcome === 'blocked' && !observer)) { stop.failed = true; break; }
  }
  return issued;
}

async function openTab(ctxInfo, id, name = 'tab0') {
  const page = await ctxInfo.ctx.newPage();
  await page.goto(draftUrl(id));
  await appReady(page, name);
  return { name, page, ctx: page, kind: 'tab' };
}
async function installDraftContextAndRestartWorker(ctxInfo, id) {
  await ctxInfo.worker.evaluate(async draftId => {
    await chrome.storage.local.set({ draftStatus: { isInDraftRoom: true, provider: 'sleeper', draftId, myDraftSlot: 1 } });
  }, id);
  const previous = ctxInfo.worker;
  const scriptURL = previous.url();
  check(new URL(scriptURL).hostname === ctxInfo.extensionId, 'Refusing to stop a foreign extension worker');
  const wakePage = await ctxInfo.ctx.newPage();
  let cdp;
  try {
    await wakePage.goto(`chrome-extension://${ctxInfo.extensionId}/options.html`);
    cdp = await ctxInfo.ctx.newCDPSession(wakePage);
    const versions = new Map();
    cdp.on('ServiceWorker.workerVersionUpdated', event => {
      for (const version of event.versions) versions.set(version.versionId, version);
      void diagnostics.write('browser.ndjson', { type: 'ServiceWorker.workerVersionUpdated', ...event });
    });
    await bounded(() => cdp.send('ServiceWorker.enable'), 10000, 'enable worker version discovery');
    let owned;
    await waitFor(() => {
      const running = [...versions.values()].filter(version => version.scriptURL === scriptURL && version.runningStatus === 'running');
      check(running.length <= 1, 'Ambiguous running versions for the owned extension worker');
      owned = running[0];
      return !!owned;
    }, 10000, 'Owned extension worker version was not reported by CDP');
    const restarted = ctxInfo.ctx.waitForEvent('serviceworker', { predicate: worker => worker !== previous && worker.url() === scriptURL, timeout: 30000 });
    restarted.catch(() => undefined);
    const closed = previous.waitForEvent('close', { timeout: 10000 });
    closed.catch(() => undefined);
    await diagnostics.write('browser.ndjson', { type: 'runner-worker-stop', id, scriptURL, versionId: owned.versionId });
    await bounded(() => cdp.send('ServiceWorker.stopWorker', { versionId: owned.versionId }), 10000, 'stop owned worker version');
    await closed;
    let response = await bounded(() => wakePage.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_DRAFT_STATUS' })), 10000, 'explicit extension worker wake');
    const firstWakeResponse = response;
    ctxInfo.worker = await restarted;
    await waitFor(async () => {
      if (response?.success && response.data?.status?.draftId === id) return true;
      response = await wakePage.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_DRAFT_STATUS' }));
      return response?.success && response.data?.status?.draftId === id;
    }, 10000, 'Replacement worker did not hydrate the seeded draft context');
    const stored = await bounded(() => ctxInfo.worker.evaluate(() => chrome.storage.local.get('draftStatus')), 5000, 'extension context read');
    check(stored.draftStatus?.draftId === id && stored.draftStatus?.isInDraftRoom === true, 'Extension worker did not retain seeded draft context');
    const proof = { stage: 'extension-worker-explicitly-woken', id, scriptURL, stoppedVersionId: owned.versionId,
      oldClosed: true, newWorker: ctxInfo.worker !== previous, firstWakeResponse, wakeResponse: response, stored, at: new Date().toISOString() };
    results.progress.push(proof);
    await diagnostics.write('browser.ndjson', proof);
    await save();
  } finally {
    try { if (cdp) await cdp.detach(); }
    finally { await wakePage.close(); }
  }
}

async function openPanel(ctxInfo, id) {
  const appTab = ctxInfo.ctx.pages().find(page => {
    const url = new URL(page.url());
    return url.origin === origin && url.pathname === '/draft' && !url.searchParams.has('__storageProbe');
  });
  check(appTab, 'Open an ordinary canonical draft app tab before the installed panel');
  await appReady(appTab, 'panel storage-sharing rendezvous tab');
  await installDraftContextAndRestartWorker(ctxInfo, id);
  const page = await ctxInfo.ctx.newPage();
  navigation?.expectPanel(page, id);
  await page.goto(`chrome-extension://${ctxInfo.extensionId}/sidepanel.html`);
  const panel = { name: 'panel', page, kind: 'panel', id };
  await mountPanel(panel, ctxInfo, id);
  return panel;
}
async function mountPanel(panel, ctxInfo, id) {
  const { page } = panel;
  await page.waitForFunction(draftId => document.querySelector('#sidepanel-frame')?.src.includes('__storageNonce=') && document.querySelector('#sidepanel-frame').src.includes(`draftId=${draftId}`), id, { timeout: 30000 });
  const frame = await (await page.locator('#sidepanel-frame').elementHandle()).contentFrame();
  check(frame, 'Side panel iframe has no document');
  const open = frame.getByRole('button', { name: UI.openLocal });
  await waitFor(async () => await open.isVisible() || await page.locator('#error-state:not([hidden])').isVisible(), 45000, 'Panel neither mounted nor showed a setup error');
  const ready = await page.locator('#error-state:not([hidden])').isVisible() ? 'error' : 'open';
  if (ready === 'error') throw new Error(`Side panel reported a setup error: ${(await page.locator('#error-state').innerText()).trim()}`);
  await diagnostics.attachFrame(frame, ctxInfo.ctx, currentLabel);
  const documentStarted = await frame.evaluate(() => performance.timeOrigin);
  await open.click();
  await appReady(frame, 'panel');
  check(await frame.evaluate(() => performance.timeOrigin) === documentStarted, 'Open local workspace navigated the iframe document');
  results.progress.push({ stage: 'panel-local-workspace', id, frameUrl: frame.url() }); await save();
  panel.ctx = frame; panel.frame = frame;
  navigation?.panelReady(page);
}
async function reloadActors(ctxInfo, actors, id) {
  for (const actor of actors) {
    if (actor.kind === 'panel') navigation?.expectPanel(actor.page, id);
    await actor.page.reload();
    if (actor.kind === 'panel') await mountPanel(actor, ctxInfo, id);
    else await appReady(actor.page, actor.name);
  }
}
async function enterManual(actors, id) {
  const [first, ...rest] = actors;
  await first.ctx.getByRole('button', { name: UI.enterManual }).waitFor({ timeout: 30000 });
  await first.ctx.getByRole('button', { name: UI.enterManual }).click();
  await first.ctx.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await first.ctx.getByRole('button', { name: UI.addProvisional }).waitFor({ timeout: 30000 });
  for (const actor of rest) {
    const add = actor.ctx.getByRole('button', { name: UI.addProvisional });
    const enter = actor.ctx.getByRole('button', { name: UI.enterManual });
    await add.or(enter).first().waitFor({ timeout: 30000 });
    const needsManualEntry = await enter.count() > 0;
    if (needsManualEntry) {
      await enter.click(); await actor.ctx.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    }
    await add.waitFor({ timeout: 30000 });
  }
}
async function startSession(ctxInfo, id, { panel = false, manual = true } = {}) {
  const tab = await openTab(ctxInfo, id, 'tab0');
  const second = panel ? await openPanel(ctxInfo, id) : await openTab(ctxInfo, id, 'tab1');
  const actors = [tab, second].map(actor => ({ ...actor, session: id }));
  for (const actor of actors) pageSessions.set(actor.page, id);
  results.progress.push({ stage: 'actors-open', id, actors: actors.map(a => ({ name: a.name, url: a.ctx.url() })) }); await save();
  await sleep(800);
  if (manual) { fixture.outage(id); await enterManual(actors, id); }
  return actors;
}
async function closeContext() {
  if (!context) return;
  const closing = context; context = null;
  await bounded(() => closing.close(), 15000, 'Browser context cleanup').catch(error => results.cleanupErrors.push(error.message));
}
const closeActors = async actors => { for (const actor of actors) await actor.page.close().catch(() => undefined); };

async function measuredSession({ ctxInfo, id, nameToId, plan, seed, panel, sequential = false, observeUntil = 0 }) {
  const actors = await startSession(ctxInfo, id, { panel });
  for (const actor of actors) actor.pacingStarted = Date.now();
  let issued;
  if (sequential) { issued = []; for (const [a, actor] of actors.entries()) issued.push(...await runActor(actor, plan.actors[a], seed + a * 9973)); }
  else { const stop = { failed: false }; issued = (await Promise.all(actors.map((actor, a) => runActor(actor, plan.actors[a], seed + a * 9973, undefined, stop)))).flat(); }
  while (Date.now() < observeUntil) { await sleep(Math.min(30000, observeUntil - Date.now())); console.log(JSON.stringify({ stage: 'focused-observation', id, remainingMs: observeUntil - Date.now() })); }
  const notSaved = await Promise.all(actors.map(a => notSavedVisible(a.ctx)));
  results.progress.push({ stage: 'workload-complete', id, issued: issued.length }); await save();
  await Promise.all(actors.map(a => drained(a.ctx)));
  const committedBefore = await readCommitted(actors[0].page, id);
  const queueCount = committedBefore.queue.length;
  const pickCount = committedBefore.picks.length;
  const before = await Promise.all(actors.map(a => readQueueIds(a, nameToId, queueCount)));
  const pickBefore = await Promise.all(actors.map(a => readProvisionalPicks(a, nameToId, pickCount)));
  results.progress.push({ stage: 'queue-before-reload', id, before }); await save();
  await reloadActors(ctxInfo, actors, id);
  results.progress.push({ stage: 'actors-reloaded', id }); await save();
  await sleep(300);
  const committed = await readCommitted(actors[0].page, id);
  const after = await Promise.all(actors.map(a => readQueueIds(a, nameToId, committed.queue.length)));
  const pickAfter = await Promise.all(actors.map(a => readProvisionalPicks(a, nameToId, committed.picks.length)));
  const pickDom = { before: pickBefore, after: pickAfter };
  const checks = auditSession({ issued, committed, committedBefore, queueDom: { before, after }, pickDom });
  const v1 = await localStorageV1(actors[0].page);
  const row = { session: id, issued, queueDom: { before, after }, pickDom, committedBefore, committed, notSavedVisible: notSaved, checks, v1 };
  if (observeUntil && flag('disconnect-control')) {
    const beforeControl = await Promise.all(actors.map(actor => actor.ctx.evaluate(() => performance.timeOrigin)));
    const clients = [...server.ws.clients];
    await diagnostics.server('controlled-websocket-disconnect', { clients: clients.length, session: id });
    row.disconnectControl = { before: beforeControl, clients: clients.length, started: new Date().toISOString() };
    for (const client of clients) client.socket.terminate();
    await waitFor(async () => (await Promise.all(actors.map(actor => actor.ctx.evaluate(() => performance.timeOrigin).catch(() => 0)))).every((time, index) => time && time !== beforeControl[index]), 30000, 'Controlled Vite disconnect did not replace both documents');
    await Promise.all(actors.map(actor => appReady(actor.ctx, actor.name)));
    row.disconnectControl.after = await Promise.all(actors.map(actor => actor.ctx.evaluate(() => performance.timeOrigin)));
    row.disconnectControl.finished = new Date().toISOString();
  }
  await closeActors(actors);
  return row;
}

async function loadCatalog(ctxInfo, needed) {
  const page = await ctxInfo.ctx.newPage();
  try {
    await page.goto(draftUrl('1699999999999'));
    await appReady(page, 'catalog probe');
    fixture.outage('1699999999999');
    await page.getByRole('button', { name: UI.enterManual }).click({ timeout: 30000 });
    const rows = await page.getByRole('dialog').getByLabel('Observed player').locator('option').evaluateAll(options => options.map(o => ({ value: o.value, label: o.textContent ?? '' })));
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    return selectCatalog(rows.map(parseCatalogOption), needed);
  } finally { await page.close(); }
}

async function focusedScenario(scenario) {
  const id = '1700000000009';
  const ctxInfo = await launch('focused-tabs');
  const setup = await ctxInfo.ctx.newPage();
  await seedV1(setup, [id]);
  scenario.activation = await activateThroughPrompt(setup, [id]);
  await setup.close();
  const catalog = await loadCatalog(ctxInfo, 600);
  const nameToId = new Map(catalog.map(player => [player.name, player.id]));
  const plan = planSession(catalog, 300);
  scenario.observationStarted = new Date().toISOString();
  const row = await measuredSession({ ctxInfo, id, nameToId, plan, seed: 3 * 1009 + 2 * 31, panel: false,
    observeUntil: Date.now() + 30 * 60 * 1000 });
  scenario.runs.push(row);
  scenario.observationFinished = new Date().toISOString();
  await save();
  check(sessionPasses(row.checks, 600), 'Focused session failed; no retry authorized');
}
async function focusedExtensionSetup() {
  currentLabel = 'extension-setup';
  const id = '1700000100009';
  const proof = results.extensionSetup = { started: new Date().toISOString(), workloadCommands: 0 };
  const ctxInfo = await launch('extension-setup');
  proof.runtime = ctxInfo.runtime; proof.launchOptions = ctxInfo.launchOptions; proof.profile = ctxInfo.profile;
  check(ctxInfo.runtime.manifest.manifest_version === 3, 'Installed extension is not Manifest V3');
  proof.hostPermission = await ctxInfo.worker.evaluate(pattern => chrome.permissions.contains({ origins: [pattern] }), `${origin}/*`);
  check(proof.hostPermission, 'Installed extension lacks the actual canonical host permission');
  const setup = await ctxInfo.ctx.newPage();
  await seedV1(setup, [id]);
  proof.activation = await activateThroughPrompt(setup, [id]);
  proof.canonicalAppTab = setup.url();
  const panel = await openPanel(ctxInfo, id);
  proof.frameUrl = panel.ctx.url();
  proof.nonceBefore = new URL(proof.frameUrl).searchParams.get('__storageNonce');
  proof.before = await readCommitted(panel.ctx, id);
  await reloadActors(ctxInfo, [panel], id);
  proof.frameUrlAfter = panel.ctx.url();
  proof.nonceAfter = new URL(proof.frameUrlAfter).searchParams.get('__storageNonce');
  proof.after = await readCommitted(panel.ctx, id);
  proof.draftStatus = await ctxInfo.worker.evaluate(() => chrome.storage.local.get('draftStatus'));
  proof.workerReset = results.progress.findLast(row => row.stage === 'extension-worker-explicitly-woken' && row.id === id);
  proof.ready = proof.activation.completed && proof.hostPermission && proof.draftStatus.draftStatus?.draftId === id &&
    proof.workerReset?.oldClosed && proof.workerReset?.newWorker && !!proof.nonceBefore && !!proof.nonceAfter && proof.nonceBefore !== proof.nonceAfter &&
    proof.before.present && proof.after.present && JSON.stringify(proof.before.picks) === JSON.stringify(proof.after.picks) &&
    JSON.stringify(proof.before.queue) === JSON.stringify(proof.after.queue);
  proof.finished = new Date().toISOString();
  await panel.page.screenshot({ path: path.join(outDir, 'extension-setup.png') });
  await save();
  check(proof.ready, 'Independent extension setup failed');
}

async function positiveScenario(scenario, scenarioIndex) {
  const label = scenario.label;
  const panel = label === 'extension-granted';
  const perActor = config.perActor;
  const need = Math.max(perActor * 2, config.bursts ? config.burstPicksPerActor * 2 + 10 : 12);
  const sessionsNeeded = config.suites * config.seeds + (config.control ? 1 : 0) + config.pickConflicts + config.moveConflicts + (config.bursts ? 1 : 0) + (config.lifecycle && label === 'tabs' ? 2 : 0) + 1;
  const ids = draftIds(scenarioIndex, sessionsNeeded + 1);
  const probeId = '1699999999999';
  const seedIds = [...ids, probeId];
  const ctxInfo = await launch(label); context = ctxInfo.ctx;
  scenario.runtime = ctxInfo.runtime; scenario.launchOptions = ctxInfo.launchOptions; scenario.profile = ctxInfo.profile;
  const setup = await context.newPage();
  scenario.seeded = await seedV1(setup, seedIds);
  scenario.activation = await activateThroughPrompt(setup, seedIds);
  scenario.activationEntries = undefined;
  await save();
  const second = await context.newPage(); await second.goto(`${origin}/draft`);
  scenario.activation.secondTabNoPrompt = (await appState(second)) === 'app';
  await second.close();
  const v1AtActivation = scenario.activation.v1Snapshot; delete scenario.activation.v1Snapshot;
  scenario.v1AtActivation = v1AtActivation;
  check(scenario.activation.completed && scenario.activation.secondTabNoPrompt, 'Activation prompt flow incomplete');

  if (config.bursts && label === 'tabs') { scenario.bursts.mock = await mockBurst(setup); await save(); check(scenario.bursts.mock.checks.good, 'mock auto-advance burst failed; no further workload authorized'); }
  await setup.close();

  const catalog = await loadCatalog(ctxInfo, need);
  const nameToId = new Map(catalog.map(c => [c.name, c.id]));
  const plan = planSession(catalog, perActor);
  scenario.catalog = catalog;
  scenario.planProblems = assertPlan(plan);
  check(!scenario.planProblems.length, `Plan problems: ${scenario.planProblems}`);

  let cursor = 0; const next = () => ids[cursor++];
  let panelWrites = 0;
  for (let suite = 1; suite <= config.suites; suite++) for (let seed = 1; seed <= config.seeds; seed++) {
    const row = await measuredSession({ ctxInfo, id: next(), catalog, nameToId, plan, seed: seed * 1009 + suite * 31, panel });
    scenario.runs.push({ suite, seed, ...row });
    panelWrites += row.issued.filter(r => r.actor === 'panel' && r.outcome === 'ack').length;
    console.log(JSON.stringify({ label, suite, seed, commands: row.checks.commands, acknowledged: row.checks.acknowledged, lost: row.checks.lost, rejected: row.checks.rejected, errors: row.checks.errors }));
    await save();
    check(sessionPasses(row.checks, 2 * perActor), `${label}: measured session failed; preserve receipts and reproduce deterministically before retry`);
  }
  if (panel) scenario.panel = { openedLocalWorkspace: scenario.runs.length > 0, reloadRecovered: scenario.runs.every(r => r.checks.queueMatchesCommitted), actorWrites: panelWrites };
  scenario.v1WritesAfterActivation = 0;
  for (const run of scenario.runs) if (JSON.stringify(sessionRows(run.v1)) !== JSON.stringify(sessionRows(v1AtActivation))) scenario.v1WritesAfterActivation++;

  if (config.control) { scenario.control = await measuredSession({ ctxInfo, id: next(), catalog, nameToId, plan, seed: 707, panel, sequential: true }); await save(); check(sessionPasses(scenario.control.checks, 2 * perActor), `${label}: sequential control failed`); }
  for (let sample = 1; sample <= config.pickConflicts; sample++) { scenario.pickConflicts.push(await pickConflict(ctxInfo, next(), catalog, sample, panel)); await save(); check(scenario.pickConflicts.at(-1).checks.good, `${label}: pick conflict ${sample} failed`); }
  for (let sample = 1; sample <= config.moveConflicts; sample++) { scenario.moveConflicts.push(await moveConflict(ctxInfo, next(), catalog, nameToId, sample, panel)); await save(); check(scenario.moveConflicts.at(-1).checks.good, `${label}: move conflict ${sample} failed`); }
  if (config.bursts) { scenario.bursts.reconcile = await reconcileBurst(ctxInfo, next(), catalog, panel); await save(); check(scenario.bursts.reconcile.checks.good, `${label}: reconciliation burst failed`); }
  if (config.lifecycle && label === 'tabs') scenario.lifecycle = await lifecycle(ctxInfo, [next(), next()], catalog, nameToId);
  const audit = await context.newPage(); await audit.goto(`${origin}/__ui-fixture/blank`);
  scenario.v1FinalSnapshot = await localStorageV1(audit);
  scenario.v1WritesAfterActivation = JSON.stringify(sessionRows(scenario.v1FinalSnapshot)) === JSON.stringify(sessionRows(v1AtActivation)) ? 0 : 1;
  await audit.close();
  check(scenario.v1WritesAfterActivation === 0, `${label}: v1 session bytes changed after activation`);
}

async function pickConflict(ctxInfo, id, catalog, sample, panel) {
  const actors = await startSession(ctxInfo, id, { panel });
  const slot = 1; const players = [catalog[0], catalog[1]];
  const cmds = players.map((p, a) => ({ id: `c:${a}`, actor: a, type: 'pick', slot, playerId: p.id, name: p.name }));
  const dialogs = [];
  for (const [a, actor] of actors.entries()) { const dialog = await openPickDialog(actor.ctx); await fillPick(dialog, cmds[a]); dialogs.push(dialog); }
  const results = await Promise.all(actors.map((actor, a) => recordAction(actor, cmds[a], async () => {
    await dialogs[a].getByRole('button', { name: UI.record, exact: true }).click();
    return awaitDialogOutcome(dialogs[a]);
  })));
  await sleep(300);
  await reloadActors(ctxInfo, actors, id);
  const committed = await readCommitted(actors[0].page, id);
  const row = { sample, session: id, results, committed, slot, players, checks: auditPickConflict({ results, committed, slot, players }) };
  await closeActors(actors); return row;
}

async function moveConflict(ctxInfo, id, catalog, nameToId, sample, panel) {
  const actors = await startSession(ctxInfo, id, { panel });
  const four = catalog.slice(0, 4);
  for (const [i, p] of four.entries()) { const row = await runCommand(actors[0], { id: `setup:${i}`, type: 'queueAdd', playerId: p.id, name: p.name }); check(row.outcome === 'ack', 'Move setup queue add failed'); }
  const original = four.map(p => p.id);
  for (const actor of actors) { await actor.ctx.getByRole('tab', { name: /^Queue/ }).click(); }
  for (const actor of actors) { await waitFor(async () => (await readQueueIds(actor, nameToId)).length === 4, 20000, 'peer queue never showed the four players'); }
  for (const actor of actors) await actor.ctx.getByRole('button', { name: 'Assistant', exact: true }).click();
  const target = four[1].name;
  const moves = [`Move ${target} up in queue`, `Move ${target} down in queue`];
  await Promise.all(actors.map((a, i) => a.ctx.getByRole('button', { name: moves[i], exact: true }).waitFor()));
  const revisionBefore = (await readCommitted(actors[0].page, id)).revision;
  const receipts = await Promise.all(actors.map((a, i) => recordAction(a, { id: `move:${i}`, type: 'queueMove', playerId: four[1].id, offset: i ? 1 : -1 }, async () => {
    await a.ctx.getByRole('button', { name: moves[i], exact: true }).click();
    await drained(a.ctx);
    if (await notSavedVisible(a.ctx)) return { outcome: 'rejected', alert: 'Draft change was not saved' };
    return { outcome: 'ack', observed: 'DOM click completed and command notice drained' };
  })));
  await Promise.all(actors.map(a => drained(a.ctx)));
  await sleep(400);
  const orders = await Promise.all(actors.map(a => assistantQueue(a.ctx, nameToId)));
  await reloadActors(ctxInfo, actors, id);
  for (const actor of actors) await actor.ctx.getByRole('button', { name: 'Assistant', exact: true }).click();
  const rendered = await Promise.all(actors.map(a => assistantQueue(a.ctx, nameToId)));
  const committed = await readCommitted(actors[0].page, id);
  const evidence = { original, orders, committedAfterReload: committed.queue, renderedAfterReload: rendered, receipts, revisionBefore, revisionAfter: committed.revision };
  const row = { sample, session: id, ...evidence, checks: auditMoveConflict(evidence) };
  await closeActors(actors); return row;
}
async function assistantQueue(ctx, nameToId) {
  await ctx.getByRole('heading', { name: 'Your queue' }).waitFor();
  const rows = ctx.locator('.rec-queue .rec-queue-identity strong');
  await waitFor(async () => (await rows.allInnerTexts()).length === 4, 20000, 'Assistant queue did not hydrate four move-test entries');
  const names = await rows.allInnerTexts();
  return names.map(n => nameToId.get(n) ?? `?${n}`);
}
async function waitFor(fn, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await bounded(fn, Math.min(5000, deadline - Date.now()), message).catch(() => false)) return; await sleep(150); }
  throw new Error(message);
}

async function reconcileBurst(ctxInfo, id, catalog, panel) {
  const per = config.burstPicksPerActor; const picks = per * 2;
  const burstCatalog = catalog.slice(0, picks);
  const cmds = [0, 1].map(a => Array.from({ length: per }, (_, i) => { const n = a * per + i; return { id: `b${a}:${i}`, actor: a, type: 'pick', slot: n + 1, playerId: burstCatalog[n].id, name: burstCatalog[n].name }; }));
  const provider = cmds.flat().map(c => { const info = slotInfo(c.slot); const p = burstCatalog[c.slot - 1];
    return { pickNumber: c.slot, round: info.round, rosterId: null, draftSlot: info.draftSlot, teamIndex: info.teamIndex, playerId: p.id, playerName: p.name, position: p.position, nflTeam: p.team,
      isKeeper: false, source: 'sleeper-api', confidence: 'confirmed', observedAt: Date.now() }; });
  const actors = await startSession(ctxInfo, id, { panel });
  let acks = 0; let flipped = false; let flippedAt = null;
  const observer = row => { if (row.outcome === 'ack') acks++; if (!flipped && acks >= Math.floor(per * 0.6)) { flipped = true; flippedAt = acks; fixture.healthy(id, provider); } };
  const issued = (await Promise.all(actors.map((a, i) => runActor(a, cmds[i], 4242 + i, observer)))).flat();
  await sleep(1500);
  const reconciledVisible = await actors[0].ctx.getByText(/Reconcil/i).count();
  await reloadActors(ctxInfo, actors, id);
  const committed = await readCommitted(actors[0].page, id);
  const evidence = { issued, committed, provider, flippedAt };
  const row = { session: id, reconciledVisible, ...evidence, checks: auditReconcileBurst(evidence) };
  await closeActors(actors); return row;
}

async function mockBurst(page) {
  const burst = { selectorsFound: false, steps: [] };
  try {
    await page.goto(`${origin}/draft`); await appReady(page, 'mock');
    const v1Before = await localStorageV1(page);
    await page.getByRole('button', { name: 'Start mock' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Fast', exact: true }).click();
    await dialog.getByRole('button', { name: 'Start mock draft' }).click();
    burst.selectorsFound = true;
    let picked = 0;
    const actor = { name: 'mock-user', page, ctx: page };
    for (let round = 0; round < 4; round++) {
      const draft = page.locator('[data-player-row] button[aria-label^="Draft "]:not([disabled])').first();
      await draft.waitFor({ timeout: 30000 });
      const name = ((await draft.getAttribute('aria-label')) ?? '').replace(/^Draft /, '');
      const receipt = await recordAction(actor, { id: `mock:${round}`, type: 'mockPick', name }, async () => {
        await draft.click(); await drained(page);
        await waitFor(async () => (await page.locator('.board-slot[aria-label]').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).some(label => label.includes(`, ${name},`)),
          10000, `Mock user pick ${name} did not appear on board`);
        return { outcome: 'ack' };
      });
      check(receipt.outcome === 'ack', `Mock pick ${round} failed`);
      picked++; burst.steps.push({ round, drafted: name, receipt });
      await sleep(600);
    }
    const fullBoard = page.getByRole('button', { name: 'Full board', exact: true });
    if (await fullBoard.isVisible()) await fullBoard.click();
    burst.board = await page.locator('.board-slot[aria-label]').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')).filter(label => /^Pick [^,]+, /.test(label) && !/^Pick [^,]+, (on the clock|My Team|in the upcoming selection window)/.test(label)));
    burst.userPicksVisible = burst.steps.every(step => burst.board.some(label => label.includes(`, ${step.drafted},`)));
    burst.cpuPicksObserved = burst.board.length - picked;
    const errors = await notSavedVisible(page);
    const v1After = await localStorageV1(page);
    burst.notSaved = errors; burst.v1Before = v1Before; burst.v1After = v1After;
    burst.checks = { ...auditMockBurst(burst), picked, notSaved: errors, v1Unchanged: JSON.stringify(v1Before) === JSON.stringify(v1After) };
  } catch (error) {
    burst.checks = { good: false, message: error.message };
  }
  return burst;
}

async function lifecycle(ctxInfo, ids, catalog, nameToId) {
  const rows = [];
  for (const [sender, id] of [[0, ids[0]], [1, ids[1]]]) {
    const row = { sender, session: id };
    const pages = [await ctxInfo.ctx.newPage(), await ctxInfo.ctx.newPage()];
    for (const page of pages) {
      await page.addInitScript(() => { BroadcastChannel.prototype.postMessage = () => undefined; window.__lifecycle = [];
        window.addEventListener('focus', e => window.__lifecycle.push({ type: 'focus', trusted: e.isTrusted }));
        document.addEventListener('visibilitychange', e => window.__lifecycle.push({ type: 'visibility', state: document.visibilityState, trusted: e.isTrusted })); });
      const focus = await ctxInfo.ctx.newCDPSession(page); await focus.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await focus.detach();
    }
    await Promise.all(pages.map(p => p.goto(draftUrl(id)))); await Promise.all(pages.map(p => appReady(p, 'lifecycle')));
    const actors = pages.map((page, i) => ({ name: `tab${i}`, page, ctx: page, kind: 'tab', session: id }));
    const receiver = 1 - sender; const player = catalog[10];
    await pages[sender].bringToFront();
    const receipt = await runCommand(actors[sender], { id: 'lifecycle:add', type: 'queueAdd', playerId: player.id, name: player.name });
    check(receipt.outcome === 'ack', 'Lifecycle sender queue add failed');
    row.receipt = receipt;
    await pages[sender].close();
    await pages[receiver].bringToFront();
    try {
      await pages[receiver].getByRole('button', { name: `Remove ${player.name} from local shortlist`, exact: true }).waitFor({ timeout: 20000 });
      row.focusRecovery = { proven: true, events: await pages[receiver].evaluate(() => window.__lifecycle) };
    } catch (error) { row.focusRecovery = { proven: false, reason: error.message }; }
    const cdp = await ctxInfo.ctx.newCDPSession(pages[receiver]);
    try {
      if (!config.headed) throw new Error('headless browser: native window visibility cannot be proven');
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      await pages[receiver].waitForFunction(() => document.visibilityState === 'hidden', null, { timeout: 3000 });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await pages[receiver].waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 3000 });
      row.nativeVisibility = { proven: false, transitionObserved: true, reason: 'Native transition alone does not prove a hidden-write re-read', events: await pages[receiver].evaluate(() => window.__lifecycle) };
    } catch (error) { row.nativeVisibility = { proven: false, reason: error.message, events: await pages[receiver].evaluate(() => window.__lifecycle).catch(() => []) }; }
    await cdp.detach();
    await pages[receiver].close(); rows.push(row);
  }
  return rows;
}

async function negativeScenario(scenario) {
  const label = scenario.label;
  let ctxInfo; let extensionDir;
  if (label === 'extension-no-permission') {
    extensionDir = path.join(outDir, 'extension-no-permission');
    await cp(path.join(root, 'extension/dist'), extensionDir, { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
    manifest.host_permissions = manifest.host_permissions.filter(value => !/^http:\/\/(localhost|127\.0\.0\.1):/.test(value));
    await writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  ctxInfo = await launch(label, { extensionDir }); context = ctxInfo.ctx;
  scenario.runtime = ctxInfo.runtime; scenario.launchOptions = ctxInfo.launchOptions;
  const hosts = label === 'hostname-split' ? ['localhost', '127.0.0.1'] : ['localhost'];
  const snapshotOrigins = async () => {
    const out = {};
    for (const host of hosts) {
      const page = await context.newPage(); await page.goto(`http://${host}:${config.port}/__ui-fixture/blank`);
      out[host] = { v1: await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fantasy-draft')).sort().map(k => [k, localStorage.getItem(k)])), databases: (await page.evaluate(() => indexedDB.databases())).map(d => d.name).sort() };
      await page.close();
    }
    return out;
  };
  const before = await snapshotOrigins();
  const id = draftIds(SCENARIOS.indexOf(label), 1)[0];
  const page = await context.newPage();
  let errorText = ''; let draftRoomAbsent = false;
  if (label === 'hostname-split') {
    await page.goto(draftUrl(id, '127.0.0.1'));
    const state = await appState(page, 30000).catch(() => 'timeout');
    errorText = state === 'blocked' ? await page.locator(UI.blocked).first().innerText() : state === 'activation' ? 'ACTIVATION PROMPT OFFERED ON NON-CANONICAL ORIGIN' : '';
    draftRoomAbsent = state === 'blocked';
    scenario.state = state;
  } else {
    await page.goto(`chrome-extension://${ctxInfo.extensionId}/sidepanel.html`);
    const errorEl = page.locator('#error-state:not([hidden])');
    const shown = await errorEl.waitFor({ timeout: 45000 }).then(() => true).catch(() => false);
    errorText = shown ? (await errorEl.innerText()).trim() : '';
    const frameSrc = await page.locator('#sidepanel-frame').getAttribute('src');
    draftRoomAbsent = shown && !frameSrc;
    scenario.state = shown ? 'blocked' : 'timeout';
    scenario.frameSrc = frameSrc;
  }
  await sleep(1000);
  const after = await snapshotOrigins();
  const flat = o => Object.values(o);
  const beforeAll = { v1: flat(before).map(x => x.v1), databases: flat(before).map(x => x.databases) };
  const afterAll = { v1: flat(after).map(x => x.v1), databases: flat(after).map(x => x.databases), errorText, draftRoomAbsent };
  scenario.blocked = { origins: { before, after }, before: beforeAll, after: afterAll, errorText, checks: auditBlocked({ before: beforeAll, after: afterAll }) };
  await page.screenshot({ path: path.join(outDir, `${label}.png`) }).catch(() => undefined);
  check(scenario.blocked.checks.good, `${label}: blocked-write proof failed (${JSON.stringify(scenario.blocked.checks)})`);
}

try {
  const extensionBuilt = await (async () => {
    const found = [];
    const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) await walk(full); else if (entry.name.endsWith('.js')) found.push(full); } };
    try { await walk(path.join(root, 'extension/dist')); } catch { return false; }
    for (const file of found) if ((await readFile(file, 'utf8')).includes('__storageNonce')) return true;
    return false;
  })();
  results.metadata.extensionBuiltWithActivation = extensionBuilt;
  if ((extensionSetupOnly || selected.some(s => s.startsWith('extension'))) && !extensionBuilt) throw new Error('extension/dist lacks the storage-sharing nonce path; run VITE_STORAGE_ACTIVATION=idb pnpm build:extension first');

  const logger = createLogger('info', { allowClearScreen: false });
  for (const level of ['info', 'warn', 'warnOnce', 'error']) {
    const log = logger[level].bind(logger);
    logger[level] = (message, options) => { diagnostics.server(`vite-${level}`, { message: String(message) }); log(message, options); };
  }
  await prepareCatalogFixture();
  if (focused) {
    server = await createServer({ customLogger: logger, root: path.join(root, 'web-app'), configFile: path.join(root, 'web-app/vite.config.ts'),
      server: { host: '127.0.0.1', port: config.port, strictPort: true, hmr: false, watch: null },
      plugins: [{ name: 'ui-activation-fixture', enforce: 'pre', configResolved(c) { c.server.watch = null; }, configureServer(vite) { vite.middlewares.use((req, res, next) => fixture.handler(req, res, next)); } }] });
    const env = server.config.env;
    results.metadata.resolvedEnv = { VITE_STORAGE_ACTIVATION: env.VITE_STORAGE_ACTIVATION, VITE_PERSISTENCE_HARNESS: env.VITE_PERSISTENCE_HARNESS, VITE_DEMO_MODE: env.VITE_DEMO_MODE, MODE: env.MODE, DEV: env.DEV, PROD: env.PROD };
    if (env.VITE_STORAGE_ACTIVATION !== 'idb' || env.VITE_PERSISTENCE_HARNESS !== undefined || env.VITE_DEMO_MODE !== undefined) throw new Error('Vite resolved the wrong build environment');
    if (server.config.server.hmr !== false || server.config.server.watch !== null) throw new Error('HMR/watch must be disabled');
    server.watcher.on('all', (event, file) => diagnostics.server('watcher', { event, file }));
    server.ws.on('connection', socket => {
      diagnostics.server('websocket-connection');
      socket.on('close', (code, reason) => diagnostics.server('websocket-close', { code, reason: String(reason) }));
      socket.on('error', error => diagnostics.server('websocket-error', { message: error.message }));
      socket.on('message', data => diagnostics.server('websocket-received', { payload: String(data) }));
    });
    const send = server.ws.send.bind(server.ws);
    server.ws.send = (...payload) => { diagnostics.server('websocket-broadcast', { payload }); return send(...payload); };
    await server.listen();
  } else if (!offline || prepareProduction) {
    let env;
    await build({ root: path.join(root, 'web-app'), configFile: path.join(root, 'web-app/vite.config.ts'), mode: 'production', customLogger: logger,
      plugins: [{ name: 'ui-production-provenance', configResolved(config) {
        const resolved = config.env;
        env = { VITE_STORAGE_ACTIVATION: resolved.VITE_STORAGE_ACTIVATION, VITE_PERSISTENCE_HARNESS: resolved.VITE_PERSISTENCE_HARNESS, VITE_DEMO_MODE: resolved.VITE_DEMO_MODE,
          MODE: resolved.MODE, DEV: resolved.DEV, PROD: resolved.PROD };
      } }] });
    results.metadata.resolvedEnv = env;
    const dist = path.join(root, 'web-app/dist');
    results.metadata.productionBuild = await inspectProductionBuild(dist, env);
    const httpServer = createHttpServer(createStaticHandler({ dist, fixture: fixture.handler, log: diagnostics.server }));
    server = { close: () => new Promise((resolve, reject) => { httpServer.close(error => error ? reject(error) : resolve()); httpServer.closeAllConnections(); }) };
    await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(config.port, '127.0.0.1', resolve); });
    results.metadata.productionHttp = await verifyProductionHttp(origin, results.metadata.productionBuild);
    const servedFixture = await (await import('@fantasy-draft/shared/http')).http.text(`${origin}/data/fantasypros-snapshot.json`, { timeoutMs: 10000, retries: 0, retryAfter: false });
    check(createHash('sha256').update(servedFixture).digest('hex') === results.metadata.catalogFixture.sha256, 'HTTP catalog fixture bytes differ from the decoded 900-identity fixture');
    results.metadata.productionHttp.catalogFixtureSha256 = results.metadata.catalogFixture.sha256;
    results.metadata.sourceHashes = await sourceSnapshot();
  }
  results.metadata.serverStarted = new Date().toISOString();
  await diagnostics.server('server-started', { serve: results.metadata.serve, env: results.metadata.resolvedEnv });
  await save();

  for (const label of selected) {
    currentLabel = label;
    const scenarioIndex = SCENARIOS.indexOf(label);
    const scenario = { label, runs: [], pickConflicts: [], moveConflicts: [], bursts: {} };
    results.scenarios.push(scenario);
    try {
      await guarded(async () => {
        if (focused) await focusedScenario(scenario);
        else if (POSITIVE.includes(label)) await positiveScenario(scenario, scenarioIndex);
        else await negativeScenario(scenario);
      });
    } catch (error) {
      results.scenarioErrors.push({ label, message: error.message, stack: error.stack });
      for (const [i, page] of (context?.pages() ?? []).entries()) {
        await failureEvidence({ page, ctx: page }, { actionId: `${label}/scenario-failure/${i}`, message: error.message });
      }
      await save();
    } finally { await closeContext(); await save(); }
    if (results.productionNavigationDefect || (flag('gate') && (results.scenarioErrors.length || results.pageErrors.length || results.cleanupErrors.length))) break;
  }
  if (focused || extensionSetupOnly) {
    try { await guarded(focusedExtensionSetup); }
    catch (error) {
      results.scenarioErrors.push({ label: 'extension-setup', message: error.message, stack: error.stack });
      for (const [index, page] of (context?.pages() ?? []).entries()) await failureEvidence({ page, ctx: page }, { actionId: `extension-setup/${index}`, message: error.message });
    }
    finally { await closeContext(); await save(); }
  }
  results.metadata.finished = new Date().toISOString();
  if (!extensionSetupOnly) results.gate = evaluateUiGate(results);
  if (tier2) results.tier2 = evaluateTier2(results);
  await save();

  if (results.scenarioErrors.length || (tier2 && !results.tier2?.passes) || (flag('gate') && !results.gate.passes)) process.exitCode = 1;
} catch (error) {
  results.fatal = { name: error.name, message: error.message, stack: error.stack }; await save(); console.error(error); process.exitCode = 1;
} finally {
  await closeContext();
  fixture.stop();
  if (server) await bounded(() => server.close(), 15000, 'HTTP server cleanup').catch(error => results.cleanupErrors.push(error.message));
  await receiptTail;
  await diagnostics.flush();
  results.metadata.gitEnd = await git();
  results.metadata.sourceHashesEnd = await sourceSnapshot();
  results.metadata.changedSourceFiles = [...new Set([...Object.keys(results.metadata.sourceHashes), ...Object.keys(results.metadata.sourceHashesEnd)])].filter(file => results.metadata.sourceHashes[file] !== results.metadata.sourceHashesEnd[file]);
  results.metadata.sourceStable = results.metadata.changedSourceFiles.length === 0;
  if (!extensionSetupOnly) results.gate = evaluateUiGate(results);
  else {
    results.setupCheck = { passes: !!results.extensionSetup?.ready && results.metadata.sourceStable &&
      results.metadata.gitEnd.head === gitStart.head && !results.metadata.gitEnd.status && !results.commandStarts.length && !results.commandLog.length &&
      !results.productionNavigationDefect && !results.fatal && !results.scenarioErrors.length && !results.pageErrors.length && !results.cleanupErrors.length,
      workloadCommands: results.commandStarts.length, fullMatrixClaim: false };
    if (!results.setupCheck.passes) process.exitCode = 1;
  }
  if (tier2) results.tier2 = evaluateTier2(results);
  if (results.scenarioErrors.length || results.pageErrors.length || results.cleanupErrors.length || !results.metadata.sourceStable || (tier2 && !results.tier2?.passes) || (flag('gate') && !results.gate.passes)) process.exitCode = 1;
  await save();
}


console.log(JSON.stringify({ smoke, setupCheck: results.setupCheck, tier2: results.tier2, plan: results.metadata.plan, sourceStable: results.metadata.sourceStable, gate: results.gate, scenarioErrors: results.scenarioErrors.map(e => `${e.label}: ${e.message}`), pageErrors: results.pageErrors.length }, null, 2));
