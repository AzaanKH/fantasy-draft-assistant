import { checkIdbGate } from './idb-gate.mjs';
import { installBlockedAdapter, auditBlocked } from './blocked-adapter.mjs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, auditConflict, summarize, failsGate } from './audit.mjs';
import { auditConflict11b, check11bBands } from './bands-11b.mjs';
import { inspectAttachedDocument, readReloadBoundary } from './reload-boundary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const requireScripts = createRequire(path.join(root, 'scripts/package.json'));
const requireWeb = createRequire(path.join(root, 'web-app/package.json'));
const { chromium } = requireScripts('playwright');
const requirePlaywright = createRequire(requireScripts.resolve('playwright'));
const coreRoot = path.dirname(requirePlaywright.resolve('playwright-core/package.json'));
const { chromiumSwitches } = requirePlaywright(path.join(coreRoot, 'lib/server/chromium/chromiumSwitches.js'));
const { createServer } = await import(requireWeb.resolve('vite'));
const out = path.resolve(process.env.PERSISTENCE_OUTPUT || path.join(root, 'artifacts/persistence'));
const origin = 'http://localhost:3000';
const suites = Number(process.env.PERSISTENCE_SUITES || 3);
const seeds = Number(process.env.PERSISTENCE_SEEDS || 5);
const count = 300;
const idb = process.env.PERSISTENCE_STORE === 'idb';
const conflictSamples = Number(process.env.PERSISTENCE_CONFLICT_SAMPLES || 20);
if (![suites, seeds].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Suites and seeds must be positive integers');
const scenarios = ['tabs', 'extension-granted', 'extension-no-permission', 'hostname-split'];
const selected = process.env.PERSISTENCE_SCENARIOS?.split(',').map(value => value.trim()) || scenarios;
if (selected.some(value => !scenarios.includes(value))) throw new Error('Unknown persistence scenario');
await mkdir(out, { recursive: true });
const results = { metadata: { started: new Date().toISOString(), root, node: process.version,
  suites, seeds, commandsPerActor: count, conflictSamplesPerKind: idb ? { pick: Number(process.env.PERSISTENCE_PICK_SAMPLES || 20), move: conflictSamples } : conflictSamples, store: idb ? 'idb' : 'v1', origin, workload: 'unique disjoint picks and shortlist additions; P9 LCG and 0..5ms jitter' },
  scenarios: [], reloadBoundaryReplacements: [], pageErrors: [], blockedRequests: [], navigations: [], scenarioErrors: [] };
results.metadata.sourceHashes = Object.fromEntries(await Promise.all([
  'web-app/src/main.tsx', 'web-app/src/workspace/browser-workspace.ts', 'web-app/src/workspace/workspace.ts',
  'web-app/src/workspace/draft-reducer.ts', 'web-app/src/workspace/dispatch-command.ts',
  'web-app/src/workspace/harness-workspace.ts', 'web-app/src/workspace/indexed-db.ts',
  'web-app/src/workspace/indexed-workspace.ts', 'web-app/src/workspace/idb-session.ts',
  'web-app/src/workspace/import-snapshot.ts', 'web-app/src/workspace/v1-import.ts', 'web-app/src/workspace/storage-sharing.ts',
  'shared/src/draft-progress.ts', 'shared/src/catalog/storage-decoders.ts',
  'extension/src/sidepanel/sidepanel.ts', 'extension/src/sidepanel/storage-sharing.ts',
  'scripts/persistence/idb-adapter.mjs', 'scripts/persistence/blocked-adapter.mjs',
  'web-app/src/stores/draftStore.ts', 'web-app/src/stores/draftSessionStorage.ts',
  'web-app/src/stores/draftSessionUnconfirmedSaves.ts', 'scripts/persistence/adapter.mjs',
  'scripts/persistence/reload-boundary.mjs', 'scripts/persistence/bands-11b.mjs', 'scripts/persistence/audit.mjs', 'scripts/persistence/run.mjs',
].map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
const save = () => writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
process.env.BROWSER_DATA_SOURCE = 'demo';
process.env.VITE_DEMO_MODE = 'true';
if (idb) process.env.VITE_PERSISTENCE_HARNESS = 'idb';
let active;
let server;
let serial = 100000;
try {
  const adapter = (await readFile(path.join(here, idb ? 'idb-adapter.mjs' : 'adapter.mjs'), 'utf8')).replace('SHARED_ROOT', path.join(root, 'shared/src'));
  server = await createServer({ root: path.join(root, 'web-app'), configFile: path.join(root, 'web-app/vite.config.ts'),
    server: { host: '127.0.0.1', port: 3000, strictPort: true, hmr: false, watch: null },
    plugins: [{ name: 'persistence-test-adapter', configResolved(config) {
      config.server.watch = null;
    }, configureServer(vite) {
      vite.middlewares.use('/__persistence/adapter.mjs', (_request, response) => {
        response.setHeader('Content-Type', 'text/javascript'); response.end(adapter);
      });
    } }] });
  results.metadata.hmr = server.config.server.hmr;
  results.metadata.watch = server.config.server.watch;
  if (results.metadata.hmr !== false || results.metadata.watch !== null) throw new Error('Persistence runs require HMR and watching disabled');
  await server.listen();
  for (const label of selected) {
    try {
      let extension = path.join(root, 'extension/dist');
      if (label === 'extension-no-permission') {
        extension = path.join(out, 'extension-no-permission');
        await cp(path.join(root, 'extension/dist'), extension, { recursive: true });
        const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
        manifest.host_permissions = manifest.host_permissions.filter(value => !/^http:\/\/(localhost|127\.0\.0\.1):/.test(value));
        await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
      }
      const defaultFeatures = chromiumSwitches(false, 'chromium', false).filter(arg => arg.startsWith('--disable-features='));
      const features = defaultFeatures.map(arg => '--disable-features=' + arg.slice('--disable-features='.length)
        .split(',').filter(name => name !== 'ThirdPartyStoragePartitioning').join(','));
      const launchOptions = { channel: 'chromium', headless: process.env.PERSISTENCE_HEADED !== 'true', viewport: { width: 1280, height: 900 },
        ignoreDefaultArgs: ['--disable-extensions', ...defaultFeatures],
        args: [...features, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
        ...(process.env.PERSISTENCE_EXECUTABLE ? { executablePath: process.env.PERSISTENCE_EXECUTABLE } : {}) };
      const profile = await mkdtemp(path.join(out, `profile-${label}-`));
      active = await chromium.launchPersistentContext(profile, launchOptions);
      active.setDefaultTimeout(30000);
      active.on('page', page => {
        page.on('pageerror', error => results.pageErrors.push({ label, url: page.url(), message: error.message }));
        page.on('framenavigated', frame => results.navigations.push({ label, at: new Date().toISOString(), url: frame.url() }));
      });
      await active.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['localhost', '127.0.0.1'].includes(url.hostname) || ['chrome-extension:', 'data:', 'about:'].includes(url.protocol)) return route.continue();
        results.blockedRequests.push(url.origin); return route.abort();
      });
      const worker = active.serviceWorkers()[0] || await active.waitForEvent('serviceworker');
      const id = new URL(worker.url()).hostname;
      await worker.evaluate(() => chrome.storage.local.set({ syncToken: 'persistence-demo-fixture-no-provider-connection' }));
      const runtime = await worker.evaluate(async () => ({ manifest: chrome.runtime.getManifest(), permissions: await chrome.permissions.getAll(), userAgent: navigator.userAgent }));
      const cdp = await active.newCDPSession(active.pages()[0]);
      const argv = await cdp.send('Browser.getBrowserCommandLine'); await cdp.detach();
      if (argv.arguments.some(arg => arg.startsWith('--disable-features=') && arg.includes('ThirdPartyStoragePartitioning'))) {
        throw new Error('Browser disabled storage partitioning');
      }
      const scenario = { label, runtime, launchOptions, argv, profile, runs: [], conflicts: [] };
      results.scenarios.push(scenario); await save();
      if (idb && ['extension-no-permission', 'hostname-split'].includes(label)) {
        const pair = await makePair(label, id, String(++serial));
        const target = pair.targets[1];
        const before = await target.evaluate(() => window.persistenceHarness.inspect());
        const issued = await target.evaluate(count => window.persistenceHarness.stress(1, count), count);
        await reload(pair);
        const after = await pair.targets[1].evaluate(() => window.persistenceHarness.inspect());
        scenario.blocked = { issued, before, after, checks: auditBlocked(issued, before, after) };
        if (scenario.blocked.checks.acknowledged || scenario.blocked.checks.rejected !== count || !scenario.blocked.checks.explicitSetupError || !scenario.blocked.checks.unchanged) throw new Error('Blocked workspace gate failed');
        await closePair(pair); await save(); continue;
      }
      if (process.env.PERSISTENCE_LIFECYCLE_ONLY !== 'true') {
      for (let suite = 1; suite <= suites; suite++) {
        for (let seed = 1; seed <= seeds; seed++) {
          const pair = await makePair(label, id, String(++serial));
          const issued = (await Promise.all(pair.targets.map((target, actor) => target.evaluate(
            ({ seed, count }) => window.persistenceHarness.stress(seed, count), { seed: seed * 1009 + actor * 9973, count })))).flat();
          await new Promise(resolve => setTimeout(resolve, 250));
          const beforeReload = await snapshots(pair);
          const stored = await inspect(pair);
          await reload(pair);
          await new Promise(resolve => setTimeout(resolve, 250));
          const afterReload = await snapshotsAfterReload(pair);
          const afterStored = await inspect(pair);
          const checks = audit(issued, afterReload, beforeReload);
          scenario.runs.push({ suite, seed, capabilities: pair.capabilities, issued, beforeReload, stored, afterReload, afterStored, checks });
          console.log(JSON.stringify({ label, suite, seed, commands: checks.commands, acknowledged: checks.acknowledged, kept: checks.kept, lost: checks.lost, absentFromBoth: checks.unionMissing.length, converged: checks.converged }));
          await save(); await closePair(pair);
        }
      }
      const control = await makePair(label, id, String(++serial));
      const controlIssued = [];
      for (const target of control.targets) controlIssued.push(...await target.evaluate(count => window.persistenceHarness.stress(707, count), count));
      await new Promise(resolve => setTimeout(resolve, 250));
      const controlBefore = await snapshots(control);
      const controlStored = await inspect(control);
      await reload(control);
      await new Promise(resolve => setTimeout(resolve, 250));
      const controlAfter = await snapshotsAfterReload(control);
      scenario.sequentialControl = { capabilities: control.capabilities, checks: audit(controlIssued, controlAfter, controlBefore),
        beforeReload: controlBefore, stored: controlStored, issued: controlIssued, afterReload: controlAfter, afterStored: await inspect(control) };
      await closePair(control); await save();
      for (const kind of ['pick', 'move']) for (let sample = 1; sample <= (idb && kind === 'pick' ? Number(process.env.PERSISTENCE_PICK_SAMPLES || 20) : conflictSamples); sample++) {
        const pair = await makePair(label, id, String(++serial));
        if (kind === 'move') for (const target of pair.targets) for (const player of ['p0', 'p1', 'p2', 'p3']) {
          await target.evaluate(player => window.persistenceHarness.issue({ type: 'shortlistAdd', player }), player);
        }
        const commands = kind === 'pick' ? [
          { id: 'conflict:a', type: 'pick', slot: 1, player: 'alice' },
          { id: 'conflict:b', type: 'pick', slot: 1, player: 'bob' },
        ] : [
          { id: 'move:a', type: 'shortlistMove', player: 'p1', toIndex: 0 },
          { id: 'move:b', type: 'shortlistMove', player: 'p1', toIndex: 3 },
        ];
        const issued = await Promise.all(pair.targets.map((target, actor) => target.evaluate(cmd => window.persistenceHarness.issue(cmd), commands[actor])));
        await new Promise(resolve => setTimeout(resolve, 250));
        const settled = await snapshots(pair);
        const stored = await inspect(pair);
        await reload(pair);
        await new Promise(resolve => setTimeout(resolve, 250));
        const afterReload = await snapshotsAfterReload(pair);
        const afterStored = await inspect(pair);
        scenario.conflicts.push({ kind, sample, capabilities: pair.capabilities, issued, settled, stored, afterReload, afterStored,
          checks: auditConflict(kind, issued, afterReload, settled),
          checks11b: auditConflict11b(kind, issued, afterReload, settled, ['tabs', 'extension-granted'].includes(label)) });
        await closePair(pair); await save();
      }
      }
      if (idb && label === 'tabs') {
        scenario.lifecycle = [];
        for (const sender of [0, 1]) {
          const pair = await makePair(label, id, String(++serial));
          await new Promise(resolve => setTimeout(resolve, 250));
          for (const page of pair.pages) {
            const nativeFocus = await active.newCDPSession(page);
            await nativeFocus.send('Emulation.setFocusEmulationEnabled', { enabled: false });
          }
          for (const target of pair.targets) await target.evaluate(() => {
            BroadcastChannel.prototype.postMessage = () => undefined;
            window.__lifecycle = [{ type: 'initial', state: document.visibilityState }];
            window.addEventListener('focus', event => window.__lifecycle.push({ type: 'focus', trusted: event.isTrusted }));
            document.addEventListener('visibilitychange', event => window.__lifecycle.push({ type: 'visibility', state: document.visibilityState, trusted: event.isTrusted }));
          });
          const receiver = 1 - sender;
          await pair.pages[sender].bringToFront();
          const receipt = await pair.targets[sender].evaluate(() => window.persistenceHarness.issue({ type: 'shortlistAdd', player: 'missed-notification' }));
          const before = await pair.targets[receiver].evaluate(() => window.persistenceHarness.snapshot());
          await pair.pages[sender].close();
          await pair.pages[receiver].bringToFront();
          try {
            await pair.targets[receiver].waitForFunction(() => window.persistenceHarness.snapshot().shortlist.includes('missed-notification'));
          } catch (error) {
            scenario.lifecycle.push({ sender, receipt, before, failure: await pair.targets[receiver].evaluate(() => ({ snapshot: window.persistenceHarness.snapshot(), events: window.__lifecycle, visibility: document.visibilityState, focused: document.hasFocus() })) });
            await save(); throw error;
          }
          const after = await pair.targets[receiver].evaluate(() => ({ snapshot: window.persistenceHarness.snapshot(), events: window.__lifecycle }));
          const row = { sender, receipt, before, after };
          const nativeVisibility = await active.newCDPSession(pair.pages[receiver]);
          const { windowId } = await nativeVisibility.send('Browser.getWindowForTarget');
          try {
            await nativeVisibility.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
            await pair.targets[receiver].waitForFunction(() => document.visibilityState === 'hidden', null, { timeout: 2000 });
            await nativeVisibility.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
            await pair.targets[receiver].waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 2000 });
            row.nativeVisibility = { proven: true, events: await pair.targets[receiver].evaluate(() => window.__lifecycle) };
          } catch (error) {
            row.nativeVisibility = { proven: false, reason: error.message, events: await pair.targets[receiver].evaluate(() => window.__lifecycle) };
          } finally { await nativeVisibility.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); }

          if (!receipt.receipt.accepted || before.shortlist.includes('missed-notification') || !after.events.some(event => event.type === 'focus' && event.trusted)) throw new Error('Trusted focus recovery failed');
          scenario.lifecycle.push(row); await pair.pages[receiver].close();
        }
      }
      if (idb && label === 'extension-granted') {
        const noAppBefore = !active.pages().some(page => page.url().startsWith(origin));
        const panel = await active.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
        await panel.waitForFunction(() => document.querySelector('#sidepanel-frame').src.includes('__storageNonce='));
        const frame = await (await panel.locator('#sidepanel-frame').elementHandle()).contentFrame();
        await frame.waitForFunction(() => !!document.querySelector('#root')?.children.length);
        await frame.waitForLoadState('networkidle');
        await frame.evaluate(async session => (await import('/__persistence/adapter.mjs')).attach({ session, actor: 1 }), String(++serial));
        const receipt = await frame.evaluate(() => window.persistenceHarness.issue({ type: 'shortlistAdd', player: 'panel-alone' }));
        const helperTabsAfter = active.pages().filter(page => page.url().includes('__storageProbe')).length;
        const ready = await panel.evaluate(() => document.querySelector('#error-state').hidden && document.querySelector('#loading-state').hidden);
        scenario.noAppStartup = { noAppBefore, ready, helperTabsAfter, receipt };
        if (!noAppBefore || !ready || helperTabsAfter || !receipt.receipt.accepted) throw new Error('Panel-alone helper gate failed');
        await panel.close();
      }
      const probe = await makePair(label, id, String(++serial));
      const marker = `sharing-${Date.now()}`;
      await probe.targets[0].evaluate(marker => localStorage.setItem(marker, 'tab'), marker);
      scenario.peerMarker = await probe.targets[1].evaluate(marker => localStorage.getItem(marker), marker);
      if (label.startsWith('extension')) {
        const bootstrapTimeoutWithMargin = 8500;
        await new Promise(resolve => setTimeout(resolve, bootstrapTimeoutWithMargin));
        scenario.extensionUI = await probe.pages[1].evaluate(() => ({
          errorHidden: document.querySelector('#error-state').hidden,
          loadingHidden: document.querySelector('#loading-state').hidden,
          pairingHidden: document.querySelector('#pairing-state').hidden,
          frame: document.querySelector('#sidepanel-frame').src,
        }));
        await probe.pages[1].screenshot({ path: path.join(out, `${label}.png`), fullPage: true });
      }
      await closePair(probe);
    } catch (error) {
      results.scenarioErrors.push({ label, message: error.message, stack: error.stack });
    } finally {
      if (active) await active.close(); active = null; await save();
    }
  }
  results.summary = summarize(results.scenarios);
  results.metadata.finished = new Date().toISOString();
  results.bands11b = check11bBands(results);
  if (idb) results.idbGate = checkIdbGate(results);
  await save();
  console.log(JSON.stringify({ summary: results.summary, pageErrors: results.pageErrors, bands11b: results.bands11b }));
  if (results.scenarioErrors.length || process.argv.includes('--gate') && failsGate(results) ||
    process.argv.includes('--gate-11b') && !results.bands11b.passes || process.argv.includes('--gate-idb') && !results.idbGate?.passes) process.exitCode = 1;
} catch (error) {
  results.fatal = { name: error.name, message: error.message, stack: error.stack }; await save(); throw error;
} finally {
  if (active) await active.close();
  if (server) await server.close();
}

async function makePair(label, extensionId, session) {
  const pages = [await active.newPage(), await active.newPage()];
  const peer = label.startsWith('extension') ? `chrome-extension://${extensionId}/sidepanel.html`
    : `${label === 'hostname-split' ? 'http://127.0.0.1:3000' : origin}/draft`;
  await Promise.all([pages[0].goto(`${origin}/draft`), pages[1].goto(peer)]);
  const pair = { pages, label, session }; await attach(pair); return pair;
}
async function attach(pair, actors = [0, 1]) {
  let second = pair.pages[1];
  if (pair.label.startsWith('extension')) {
    if (idb) await second.waitForFunction(() => !document.querySelector('#error-state').hidden || document.querySelector('#sidepanel-frame').src.includes('__storageNonce='));
    if (idb && await second.evaluate(() => !document.querySelector('#error-state').hidden)) {
      pair.targets = [pair.pages[0], second];
      pair.capabilities ??= [];
      pair.capabilities[1] = await second.evaluate(installBlockedAdapter, { session: pair.session, actor: 1 });
      return;
    }
    await second.waitForFunction(() => document.querySelector('#sidepanel-frame').src.startsWith('http://localhost:3000/sidepanel'));
    second = await (await second.locator('#sidepanel-frame').elementHandle()).contentFrame();
  }
  pair.targets = [pair.pages[0], second];
  pair.capabilities ??= [];
  await Promise.all(actors.map(async actor => {
    const target = pair.targets[actor];
    await target.locator('#root > *').first().waitFor({ state: 'attached' });
    await target.waitForLoadState('networkidle');
    if (idb && await target.locator('[data-storage-blocked]').count()) {
      await target.evaluate(async () => {
        const { getBrowserWorkspace } = await import('/src/workspace/browser-workspace.ts');
        window.__persistenceHasOwner = () => { try { getBrowserWorkspace(); return true; } catch { return false; } };
      });
      pair.capabilities[actor] = await target.evaluate(installBlockedAdapter, { session: pair.session, actor }); return;
    }
    pair.capabilities[actor] = await target.evaluate(async ({ session, actor }) => {
      const { attach } = await import('/__persistence/adapter.mjs');
      return attach({ session, actor });
    }, { session: pair.session, actor });
  }));
}
async function reload(pair) { await Promise.all(pair.pages.map(page => page.reload())); await attach(pair); }
async function readDocuments(pair) {
  return Promise.all(pair.targets.map((target, actor) => target.evaluate(({ expected, actor }) => {
    if (performance.timeOrigin !== expected) return { kind: 'replaced', actor, expected, actual: performance.timeOrigin,
      url: location.href, readyState: document.readyState, discarded: document.wasDiscarded };
    if (!window.persistenceHarness) throw new Error('Persistence adapter missing in its attached document');
    return { kind: 'snapshot', actor, snapshot: window.persistenceHarness.snapshot() };
  }, { expected: pair.capabilities[actor].documentId, actor })));
}
async function snapshots(pair) {
  const rows = await readDocuments(pair);
  if (rows.some(row => row.kind === 'replaced')) throw new Error(`Unexpected document replacement during commands: ${JSON.stringify(rows)}`);
  return rows.map(row => row.snapshot);
}
async function snapshotsAfterReload(pair) {
  return readReloadBoundary({ read: () => readDocuments(pair), attach: actors => attach(pair, actors), recordReplacement: rows => {
    results.reloadBoundaryReplacements.push({ label: pair.label, session: pair.session, rows });
  } });
}
async function inspect(pair) {
  return Promise.all(pair.targets.map((target, actor) => target.evaluate(inspectAttachedDocument, pair.capabilities[actor].documentId)));
}
async function closePair(pair) { await Promise.all(pair.pages.map(page => page.close())); }
