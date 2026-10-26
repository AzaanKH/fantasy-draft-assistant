// Run: pnpm --filter scripts exec tsx --conditions=@fantasy-draft/source ../scripts/persistence/native-visibility.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Effect } from 'effect';
import { Processes } from '@fantasy-draft/shared/node';
import { buildCatalogFixture } from './ui-adapter.mjs';
import { buildReadinessFixture } from './ui-readiness.mjs';
import { inspectProductionBuild, createStaticHandler, verifyProductionHttp, verifyFixtureHttp, sha256 } from './ui-production.mjs';
import { nativeVisibilityExitCode } from './native-visibility-result.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.NATIVE_VISIBILITY_OUTPUT;
if (!out || !path.isAbsolute(out)) throw new Error('Set NATIVE_VISIBILITY_OUTPUT to a fresh absolute evidence directory');
const requireScripts = createRequire(path.join(root, 'scripts/package.json'));
const requireWeb = createRequire(path.join(root, 'web-app/package.json'));
const { chromium } = requireScripts('playwright');
const visibilityFlags = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const result = { started: new Date().toISOString(), root, pid: process.pid, trials: [], pageErrors: [], cleanup: [], verdict: 'NOT PROVEN' };
let server, context;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, message) => { if (!value) throw new Error(message); };
async function persist() { await writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2)); }
async function committed(page, id) {
  return page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('fantasy-draft-workspace-v2'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise((resolve, reject) => { const tx = db.transaction('sessions', 'readonly'); const r = tx.objectStore('sessions').get(`sleeper:${id}`); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
    finally { db.close(); }
  }, id);
}
async function state(page) { return page.evaluate(() => ({ at: performance.timeOrigin + performance.now(), visibility: document.visibilityState, focus: document.hasFocus(), events: window.__nativeEvidence.events, reads: window.__nativeEvidence.reads, suppressedBroadcasts: window.__nativeEvidence.suppressedBroadcasts, uiObservedAt: window.__nativeEvidence.uiObservedAt, navigationCount: performance.getEntriesByType('navigation').length, timeOrigin: performance.timeOrigin })); }
async function drained(page) {
  for (let i = 0; i < 300; i++) { if (!await page.getByText(/^Saving \d+ draft change/).count()) { await pause(100); if (!await page.getByText(/^Saving \d+ draft change/).count()) return; } await pause(50); }
  throw new Error('Saving notice did not drain');
}
async function pool(page, name) {
  const search = page.getByPlaceholder('Search player or team');
  if (!await search.isVisible()) {
    const expand = page.getByRole('button', { name: 'Expand player workspace' });
    if (await expand.isVisible()) await expand.click();
    const tab = page.getByRole('tab', { name: /^Players/ }); if (await tab.isVisible()) await tab.click();
  }
  await search.fill(name);
  await page.getByRole('button', { name: `Add ${name} to local shortlist`, exact: true }).waitFor();
}
function instrumentation() {
  const clock = () => performance.timeOrigin + performance.now();
  const log = window.__nativeEvidence = { events: [], reads: [], suppressedBroadcasts: [], uiObservedAt: null, label: null };
  BroadcastChannel.prototype.postMessage = function(value) { log.suppressedBroadcasts.push({ at: clock(), value }); };
  for (const type of ['focus', 'blur']) window.addEventListener(type, e => log.events.push({ type, trusted: e.isTrusted, at: performance.timeOrigin + e.timeStamp, visibility: document.visibilityState, focus: document.hasFocus() }), true);
  document.addEventListener('visibilitychange', e => log.events.push({ type: 'visibilitychange', state: document.visibilityState, trusted: e.isTrusted, at: performance.timeOrigin + e.timeStamp, focus: document.hasFocus() }), true);
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function(key) { if (this.name === 'sessions') log.reads.push({ key, at: clock(), visibility: document.visibilityState, focus: document.hasFocus(), lastEvent: log.events.at(-1) }); return get.call(this, key); };
  const observer = new MutationObserver(() => { if (log.label && !log.uiObservedAt && [...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === log.label)) log.uiObservedAt = clock(); });
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
}
// Playwright 1.57 enables focus emulation on its owning protocol session. A
// separate CDP session cannot clear that session's override. Disable it there.
async function disableFocusEmulation(page) {
  const impl = page._connection.toImpl(page);
  const client = impl.delegate._mainFrameSession._client;
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  result.focusEmulationDisabled ??= [];
  result.focusEmulationDisabled.push({ at: Date.now(), targetId: impl.delegate._targetId, sessionId: client._sessionId, method: 'Playwright-owning-session', url: page.url() });
}
async function launch(label, removeFlags = true) {
  const profile = await mkdtemp(path.join(out, `profile-${label}-`));
  context = await chromium.launchPersistentContext(profile, { headless: false, channel: 'chromium', ignoreDefaultArgs: removeFlags ? visibilityFlags : [], viewport: { width: 1280, height: 900 }, timeout: 30000 });
  const cdp = await context.browser().newBrowserCDPSession();
  const processes = await cdp.send('SystemInfo.getProcessInfo');
  result.processes ??= []; result.processes.push({ label, profile, processInfo: processes.processInfo });
  result.launches ??= []; result.launches.push({ label, removeFlags, version: await cdp.send('Browser.getVersion'), commandLine: await cdp.send('Browser.getBrowserCommandLine') });
  return cdp;
}
async function run() {
  await mkdir(out); await persist();
  result.head = (await Processes.run('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 10000 })).stdout.trim();
  result.scriptSha256 = sha256(await readFile(fileURLToPath(import.meta.url)));
  result.platform = { platform: process.platform, node: process.version };
  // Probe both native paths with the requested flags absent, then a default-args control.
  result.probes = [];
  for (const removeFlags of [true, false]) {
    const probe = { removeFlags, events: {} }; result.probes.push(probe);
    try {
      const cdp = await launch(removeFlags ? 'probe-flags-removed' : 'probe-default-args', removeFlags);
      await context.addInitScript(instrumentation);
      const a = context.pages()[0];
      await a.goto('data:text/html,<title>Native blank A</title>');
      const aCdp = await context.newCDPSession(a);
      await aCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await disableFocusEmulation(a);
      const { windowId } = await aCdp.send('Browser.getWindowForTarget'); probe.windowId = windowId;
      await a.bringToFront(); probe.before = await state(a);
      await aCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      try { await a.waitForFunction(() => document.visibilityState === 'hidden', null, { polling: 50, timeout: 5000 }); probe.minimizeHidden = true; }
      catch (error) { probe.minimizeHidden = false; probe.minimizeError = error.message; }
      probe.minimizedBounds = await aCdp.send('Browser.getWindowBounds', { windowId }); probe.afterMinimize = await state(a);
      await aCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      try { await a.waitForFunction(() => document.visibilityState === 'visible', null, { polling: 50, timeout: 5000 }); probe.restoreVisible = true; }
      catch (error) { probe.restoreVisible = false; probe.restoreError = error.message; }
      probe.afterRestore = await state(a);
      const newPage = context.waitForEvent('page'); await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: false }); const b = await newPage;
      await b.goto('data:text/html,<title>Native blank B</title>');
      const bCdp = await context.newCDPSession(b); await bCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await disableFocusEmulation(b);
      probe.tabWindows = await Promise.all([aCdp, bCdp].map(c => c.send('Browser.getWindowForTarget')));
      check(probe.tabWindows[0].windowId === probe.tabWindows[1].windowId, 'Probe tabs are not in one window');
      await a.bringToFront(); await b.bringToFront();
      try { await a.waitForFunction(() => document.visibilityState === 'hidden', null, { polling: 50, timeout: 5000 }); probe.tabSwitchHidden = true; }
      catch (error) { probe.tabSwitchHidden = false; probe.tabSwitchError = error.message; }
      probe.afterTabSwitch = await state(a);
      await a.bringToFront();
      await a.waitForFunction(() => document.visibilityState === 'visible', null, { polling: 50, timeout: 5000 });
      probe.afterTabReturn = await state(a);
      await a.screenshot({ path: path.join(out, removeFlags ? 'probe-flags-removed.png' : 'probe-default-args.png') });
      console.log(JSON.stringify({ probe: removeFlags ? 'flags-removed' : 'default-args', minimizeHidden: probe.minimizeHidden, minimizedBounds: probe.minimizedBounds, tabSwitchHidden: probe.tabSwitchHidden }));
    } catch (error) { probe.error = { message: error.message, stack: error.stack }; }
    finally { if (context) { await context.close(); context = undefined; result.cleanup.push(`Probe removeFlags=${removeFlags} browser closed`); } await persist(); }
  }
  const nativeProbe = result.probes.find(p => p.removeFlags);
  const paths = [...(nativeProbe.tabSwitchHidden ? ['tab-switch'] : []), ...(nativeProbe.minimizeHidden && nativeProbe.restoreVisible ? ['minimize-restore'] : [])];
  result.eligiblePaths = paths;
  check(paths.length, 'Neither native path reached hidden with the requested flags removed');
  delete process.env.VITE_PERSISTENCE_HARNESS; delete process.env.VITE_DEMO_MODE;
  process.env.VITE_STORAGE_ACTIVATION = 'idb'; process.env.BROWSER_DATA_SOURCE = 'demo';
  // Reserve a free port before building, so the build's canonical origin matches it.
  server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; const origin = `http://localhost:${port}`; process.env.DRAFT_WEB_PORT = String(port);
  result.origin = origin;
  const { build } = await import(requireWeb.resolve('vite')); let env;
  await build({ root: path.join(root, 'web-app'), configFile: path.join(root, 'web-app/vite.config.ts'), mode: 'production', plugins: [{ name: 'native-visibility-provenance', configResolved(c) { const e = c.env; env = { MODE: e.MODE, DEV: e.DEV, PROD: e.PROD, VITE_STORAGE_ACTIVATION: e.VITE_STORAGE_ACTIVATION, VITE_PERSISTENCE_HARNESS: e.VITE_PERSISTENCE_HARNESS, VITE_DEMO_MODE: e.VITE_DEMO_MODE }; } }] });
  result.productionBuild = await inspectProductionBuild(path.join(root, 'web-app/dist'), env);
  const input = await Promise.all(['fantasypros-snapshot.json', 'player-identity.json', 'predictions.json', 'sleeper-adp.json'].map(async name => JSON.parse(await readFile(path.join(root, 'demo-data', name), 'utf8'))));
  const { snapshot, catalog } = buildCatalogFixture(input[0], input[1], input[2]);
  const fixture = buildReadinessFixture({ snapshot, identities: input[1], sleeper: input[3], catalog });
  await writeFile(path.join(out, 'readiness-fixture.json'), JSON.stringify(fixture, null, 2));
  server.on('request', createStaticHandler({ dist: path.join(root, 'web-app/dist'), fixture(req, res, next) {
    const p = new URL(req.url, origin).pathname;
    if (p === '/__native/blank') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Native visibility seed</title>'); return; }
    if (fixture.files[p]) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture.files[p])); return; }
    // Intentionally disconnected provider. This test writes only a local shortlist.
    if (p.startsWith('/api/')) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"offline native visibility fixture"}'); return; }
    next();
  } }));
  result.productionHttp = await verifyProductionHttp(origin, result.productionBuild);
  result.fixtureHttp = await verifyFixtureHttp(origin, fixture.files);
  for (const nativePath of paths) for (let n = 1; n <= 5; n++) {
    const id = String(1790000000000 + (nativePath === 'tab-switch' ? 0 : 100) + n), senderIndex = n % 2 ? 0 : 1, receiverIndex = 1 - senderIndex;
    const key = `${nativePath}-${n}`;
    const row = { path: nativePath, trial: n, id, sender: ['A', 'B'][senderIndex], receiver: ['A', 'B'][receiverIndex], variant: nativePath === 'tab-switch' ? 'native-tab-activation-no-extra-focus' : n <= 3 ? 'restore-only-no-bringToFront' : 'restore-then-explicit-focus', started: Date.now() }; result.trials.push(row); await persist();
    try {
      const cdp = await launch(key); context.setDefaultTimeout(20000);
      await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await context.addInitScript(instrumentation);
      context.on('page', page => page.on('pageerror', error => result.pageErrors.push({ trial: n, message: error.message })));
      const pages = [context.pages()[0]];
      await pages[0].goto(`${origin}/__native/blank`);
      const seedInput = path.join(out, `seed-${key}-input.json`), seedOutput = path.join(out, `seed-${key}.json`);
      await writeFile(seedInput, JSON.stringify({ ids: [id], teams: 20, rounds: 20, output: seedOutput, leaguePreferences: fixture.leaguePreferences }));
      await Processes.run(process.execPath, [requireScripts.resolve('tsx/cli'), '--conditions=@fantasy-draft/source', path.join(root, 'scripts/persistence/ui-seed.mjs'), seedInput], { cwd: root, timeoutMs: 30000 });
      const entries = JSON.parse(await readFile(seedOutput, 'utf8'));
      await pages[0].evaluate(entries => { for (const [k, v] of entries) localStorage.setItem(k, v); }, entries);
      await pages[0].goto(`${origin}/draft`);
      await pages[0].getByLabel(/I have closed other draft tabs and side panels/i).check();
      await pages[0].getByRole('button', { name: 'Activate IndexedDB', exact: true }).click();
      await pages[0].getByRole('button', { name: 'Draft workspace', exact: true }).waitFor();
      const newPage = context.waitForEvent('page');
      await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: nativePath === 'minimize-restore' }); pages.push(await newPage);
      const sessions = await Promise.all(pages.map(p => context.newCDPSession(p)));
      for (const session of sessions) await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
      for (const page of pages) await disableFocusEmulation(page);
      row.windows = await Promise.all(sessions.map(s => s.send('Browser.getWindowForTarget')));
      check((row.windows[0].windowId === row.windows[1].windowId) === (nativePath === 'tab-switch'), 'Native window topology does not match the path');
      await Promise.all(pages.map(p => p.goto(`${origin}/draft?provider=sleeper&draftId=${id}&position=1&settings=quick-mock`)));
      const player = catalog[n + 10]; row.player = player;
      for (const page of pages) { await page.bringToFront(); await page.getByRole('button', { name: 'Draft workspace', exact: true }).waitFor(); await pool(page, player.name); }
      const receiver = pages[receiverIndex], sender = pages[senderIndex], receiverCdp = sessions[receiverIndex], windowId = row.windows[receiverIndex].windowId;
      const label = `Remove ${player.name} from local shortlist`;
      await receiver.evaluate(label => { window.__nativeEvidence.label = label; window.__nativeEvidence.uiObservedAt = null; }, label);
      await receiver.bringToFront(); await sender.bringToFront();
      row.before = await state(receiver); row.idbBefore = await committed(sender, id);
      if (nativePath === 'minimize-restore') await receiverCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      await receiver.waitForFunction(() => document.visibilityState === 'hidden', null, { polling: 50, timeout: 5000 });
      row.hidden = await state(receiver); row.minimizedBounds = await receiverCdp.send('Browser.getWindowBounds', { windowId });
      row.writeStartedAt = await sender.evaluate(() => performance.timeOrigin + performance.now());
      await sender.getByRole('button', { name: `Add ${player.name} to local shortlist`, exact: true }).click();
      await sender.getByRole('button', { name: label, exact: true }).waitFor(); await drained(sender);
      row.ackAt = await sender.evaluate(() => performance.timeOrigin + performance.now());
      row.idbAfterAck = await committed(sender, id);
      check(row.idbAfterAck.shortlistedPlayerIds.includes(player.id), 'UI acknowledgment missing from durable IDB');
      row.hiddenAfterAck = await state(receiver); row.hiddenUiHasWrite = await receiver.getByRole('button', { name: label, exact: true }).count();
      check(row.hiddenAfterAck.visibility === 'hidden' && !row.hiddenUiHasWrite, 'Receiver did not remain hidden and stale until restore');
      row.restoreRequestedAt = Date.now();
      if (nativePath === 'minimize-restore') await receiverCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      else await receiver.bringToFront();
      await receiver.waitForFunction(() => document.visibilityState === 'visible', null, { polling: 50, timeout: 5000 });
      if (nativePath === 'minimize-restore' && n > 3) { row.explicitFocusRequestedAt = Date.now(); await receiver.bringToFront(); }
      try { await receiver.getByRole('button', { name: label, exact: true }).waitFor({ timeout: 15000 }); row.uiHasWrite = true; }
      catch { row.uiHasWrite = false; }
      await pause(300); row.after = await state(receiver); row.senderAfter = await state(sender);
      row.restoredBounds = await receiverCdp.send('Browser.getWindowBounds', { windowId });
      row.screenshot = `trial-${key}-restored.png`; await receiver.screenshot({ path: path.join(out, row.screenshot), fullPage: true });
      row.idbAfterRestore = await committed(receiver, id);
      await writeFile(path.join(out, `trial-${key}-receiver.html`), await receiver.content());
      row.visibleEventsAfterAck = row.after.events.filter(e => e.type === 'visibilitychange' && e.state === 'visible' && e.trusted && e.at > row.ackAt);
      row.focusEventsAfterAck = row.after.events.filter(e => e.type === 'focus' && e.at > row.ackAt);
      row.noReload = row.before.timeOrigin === row.after.timeOrigin;
      row.passes = row.hidden.visibility === 'hidden' && row.hiddenAfterAck.visibility === 'hidden' && row.visibleEventsAfterAck.length > 0 && row.uiHasWrite && row.noReload && row.idbAfterRestore.shortlistedPlayerIds.includes(player.id);
      if (!row.uiHasWrite) result.verdict = 'PRODUCT DEFECT';
      console.log(JSON.stringify({ path: nativePath, trial: n, passes: row.passes, visibilityEvents: row.visibleEventsAfterAck, focusEvents: row.focusEventsAfterAck, uiObservedAt: row.after.uiObservedAt, ackAt: row.ackAt }));
    } catch (error) { row.error = { message: error.message, stack: error.stack }; throw error; }
    finally { if (context) { await context.close(); context = undefined; result.cleanup.push(`Trial ${key} browser closed`); } await persist(); }
  }
  result.pathVerdicts = Object.fromEntries(paths.map(p => { const rows = result.trials.filter(t => t.path === p); return [p, rows.length === 5 && rows.every(t => t.passes) ? 'PROVEN' : rows.some(t => t.uiHasWrite === false) ? 'PRODUCT DEFECT' : 'NOT PROVEN']; }));
  if (Object.values(result.pathVerdicts).includes('PRODUCT DEFECT')) result.verdict = 'PRODUCT DEFECT';
  else if (paths.length === 2 && Object.values(result.pathVerdicts).every(verdict => verdict === 'PROVEN')) result.verdict = 'PROVEN';
}
try { await Effect.runPromise(Effect.tryPromise(run)); }
catch (error) { result.error = { message: String(error.cause?.message ?? error), stack: error.cause?.stack ?? error.stack }; console.error(result.error); process.exitCode = 1; }
try { if (context) { await context.close(); result.cleanup.push('Remaining browser closed'); } if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); result.cleanup.push('Owned production server closed; no pkill or killall used'); }
catch (error) { result.cleanup.push({ error: error.message }); }
result.exitCode = nativeVisibilityExitCode(result);
result.finished = new Date().toISOString(); await persist();
const lines = [`# Native visibility release gate`, '', `Verdict: **${result.verdict}**`, '', `Commit: \`${result.head}\`. Harness: \`${path.relative(root, fileURLToPath(import.meta.url))}\`.`, '', result.productionBuild ? 'Production static build with VITE_STORAGE_ACTIVATION=idb; runtime demo and persistence harness flags absent. Local readiness HTTP fixtures use installed demo identities. No live provider refresh was run.' : 'Stopped at the initial native headed Chromium probe, before the production build or any write trial. No production activation or hidden-write recovery claim is made.', '', 'Trial method: two tabs in one native window for tab-switch, or two real Chromium windows for minimize/restore, focus emulation explicitly disabled in both, BroadcastChannel.postMessage suppressed in both. Every trial uses a fresh profile and draft. Writes use the real shortlist UI and require the Remove button, drained Saving notice, and durable IDB readback. This method is unverified if the native probe failed.', ''];
for (const t of result.trials) { lines.push(`## ${t.path} trial ${t.trial}: ${t.sender} to ${t.receiver}`, '', `Variant: ${t.variant}. Passed: ${Boolean(t.passes)}.`, '', `Hidden after ack: ${t.hiddenAfterAck?.visibility ?? 'unavailable'}. Hidden UI had write: ${t.hiddenUiHasWrite ?? 'unavailable'}. Ack: ${t.ackAt ?? 'unavailable'}.`, '', `Trusted visible events after ack: ${JSON.stringify(t.visibleEventsAfterAck ?? [])}.`, '', `Focus events after ack: ${JSON.stringify(t.focusEventsAfterAck ?? [])}. UI observed at: ${t.after?.uiObservedAt ?? 'unavailable'}. No reload: ${t.noReload ?? 'unavailable'}.`, '', `Screenshot: ${t.screenshot ?? 'unavailable'}. Full IDB rows and millisecond event/read timestamps: results.json.`, '', ...(t.error ? [`Error: ${t.error.message}`, ''] : [])); }
lines.push('## Native prerequisite probes', '', JSON.stringify(result.probes, null, 2), '', `Path verdicts: ${JSON.stringify(result.pathVerdicts ?? {})}`, '');
if (result.error) lines.push(`Failure: ${result.error.message}`, '', 'Alternative if native headed launch/minimize is unavailable: rerun this same harness in an interactive macOS login session with visible Chromium windows. Do not substitute headless or dispatched events for this native gate.', '');
lines.push('## Cleanup', '', ...result.cleanup.map(x => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`), '', 'No product code changed. No commit or push. Fresh evidence profiles remain under the evidence directory for audit. See results.json for owned process IDs and build/HTTP hashes.', '');
await writeFile(path.join(out, 'NATIVE-VISIBILITY.md'), lines.join('\n'));
console.log(`Verdict: ${result.verdict}; evidence: ${out}`);
process.exitCode = result.exitCode;
