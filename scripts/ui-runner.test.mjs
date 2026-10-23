import { test, expect } from 'vitest';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createDiagnostics, createNavigationGuard } from './persistence/ui-diagnostics.mjs';
import { runnerMode } from './persistence/ui-runner-mode.mjs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { auditSession, sessionPasses } from './persistence/ui-adapter.mjs';

const { JSDOM, VirtualConsole } = createRequire(new URL('../web-app/package.json', import.meta.url))('jsdom');
const source = await readFile(new URL('./persistence/ui-activation.mjs', import.meta.url), 'utf8');
const functionSource = (name, next) => source.slice(source.indexOf(`async function ${name}(`), source.indexOf(`async function ${next}(`));

// These controls are unchanged excerpts of ui-final-f4927c9/failure-0001.html.
const mockControls = await readFile(new URL('./persistence/fixtures/mock-player-controls.html', import.meta.url), 'utf8');
test('the saved failure DOM selects an enabled catalog player instead of Draft status', () => {
  const mock = source.slice(source.indexOf('async function mockBurst('));
  const [, selector] = /const draft = page\.locator\('([^']+)'\)\.first\(\)/.exec(mock);
  const document = new JSDOM(mockControls, { virtualConsole: new VirtualConsole() }).window.document;
  const selected = document.querySelector(selector);
  expect(selected).toBeTruthy();
  expect(selected.closest('[data-player-row]')).toBeTruthy();
  expect(selected.disabled).toBe(false);
  expect(selected.getAttribute('aria-label')).toBe('Draft Christian McCaffrey');
});

const picked = { pickNumber: 1, playerId: 'p1' };
const ambiguous = { pickNumber: 2, playerId: 'p2' };
const issued = [
  { cmd: { id: 'ack', type: 'pick', slot: 1, playerId: 'p1' }, outcome: 'ack' },
  { cmd: { id: 'navigated', type: 'pick', slot: 2, playerId: 'p2' }, outcome: 'error', message: 'Execution context was destroyed' },
];
const committed = { present: true, picks: [picked, ambiguous], queue: [] };
const evidence = () => ({ issued: structuredClone(issued), committed, committedBefore: committed,
  queueDom: { before: [[], []], after: [[], []] }, pickDom: { before: [committed.picks, committed.picks], after: [committed.picks, committed.picks] } });

test('commit before navigation retains acknowledged facts and reports the ambiguous unacknowledged pick', () => {
  const checks = auditSession(evidence());
  expect(checks.kept).toBe(1);
  expect(checks.acknowledged).toBe(1);
  expect(checks.lost).toBe(0);
  expect(checks.unacknowledgedCommitted).toEqual([{ fact: 'pick:2:p2', commandId: 'navigated', outcome: 'error' }]);
  expect(checks.unexpected).toEqual([]);
  expect(checks.picksMatchDom).toBe(true);
  expect(sessionPasses(checks, 2)).toBe(false);
});

test('an unissued pick and a missing acknowledged pick still fail the audit', () => {
  const args = evidence(); args.issued = [issued[0]];
  expect(auditSession(args).unexpected).toEqual(['pick:2:p2']);
  args.committed = { ...committed, picks: [ambiguous] };
  expect(auditSession(args).lost).toBe(1);
});

test('the post-navigation DOM observation hydrates all committed facts, including the unacknowledged one', async () => {
  const actors = [{ page: {}, ctx: {}, name: 'tab0' }, { page: {}, ctx: {}, name: 'tab1' }];
  const readPicks = async (_actor, _names, count) => {
    expect(count, 'DOM hydration must use the committed superset').toBe(2);
    return committed.picks;
  };
  const measured = runInNewContext(`(${functionSource('measuredSession', 'loadCatalog')})`, {
    startSession: async () => actors, runActor: async (_actor, commands) => [issued[commands[0]]],
    sleep: async () => {}, notSavedVisible: async () => false, drained: async () => {},
    readQueueIds: async () => [], readProvisionalPicks: readPicks, readCommitted: async () => committed,
    reloadActors: async () => {}, auditSession, localStorageV1: async () => [], closeActors: async () => {},
    results: { progress: [] }, save: async () => {},
  });
  const row = await measured({ ctxInfo: {}, id: '1700000000009', nameToId: new Map(), plan: { actors: [[0], [1]] }, seed: 1 });
  expect(row.checks.acknowledged).toBe(1);
  expect(row.checks.unacknowledgedCommitted).toHaveLength(1);
});

test.each([
  { delayedVersion: false, delayedHydration: false }, { delayedVersion: true, delayedHydration: false },
  { delayedVersion: false, delayedHydration: true }, { delayedVersion: true, delayedHydration: true },
])('stops only the owned worker and explicitly wakes its replacement from a registered page, delayedVersion=$delayedVersion delayedHydration=$delayedHydration', async ({ delayedVersion, delayedHydration }) => {
  const events = [];
  const stored = {};
  const scriptURL = 'chrome-extension://fixture/background.js';
  let emitWorker;
  let emitClosed;
  let closed = false;
  let pageLoaded = false;
  let memory = { draftId: 'old-worker-memory' };
  const replacement = { url: () => scriptURL, evaluate: async (fn, arg) => runInNewContext(`(${fn.toString()})(arg)`, { arg, chrome }) };
  const chrome = { storage: { local: { set: async values => Object.assign(stored, values), get: async () => stored } }, runtime: {
    reload: () => { throw new Error('Whole-extension unload is forbidden'); },
    sendMessage: async message => {
      expect(pageLoaded).toBe(true); expect(closed).toBe(true); expect(message.type).toBe('GET_DRAFT_STATUS');
      const firstWake = !events.includes('explicit-wake');
      events.push('explicit-wake');
      if (!delayedHydration || !firstWake) memory = stored.draftStatus;
      if (firstWake) emitWorker(replacement);
      return { success: true, data: { status: memory } };
    },
  } };
  const previous = { url: () => scriptURL, evaluate: replacement.evaluate,
    waitForEvent: name => { expect(name).toBe('close'); events.push('listen-close'); return new Promise(resolve => { emitClosed = resolve; }); },
  };
  const versions = [
    { versionId: 'foreign', scriptURL: 'https://foreign.invalid/sw.js', runningStatus: 'running' },
    { versionId: 'old-inactive', scriptURL, runningStatus: 'stopped' },
    { versionId: 'owned', scriptURL, runningStatus: 'running' },
  ];
  let publishVersions;
  let deferredVersion;
  const cdp = {
    on: (name, listener) => { expect(name).toBe('ServiceWorker.workerVersionUpdated'); publishVersions = listener; },
    send: async (method, args) => {
      events.push(method);
      if (method === 'ServiceWorker.enable') {
        expect(pageLoaded).toBe(true);
        publishVersions({ versions: delayedVersion ? versions.slice(0, 2) : versions });
        if (delayedVersion) deferredVersion = () => publishVersions({ versions: [versions[2]] });
      } else if (method === 'ServiceWorker.stopWorker') {
        expect(args).toEqual({ versionId: 'owned' }); expect(memory.draftId).toBe('old-worker-memory');
        closed = true; events.push('old-closed'); emitClosed();
      } else throw new Error(`Unexpected protocol operation ${method}`);
    },
    detach: async () => events.push('detach'),
  };
  const page = { goto: async url => { expect(closed).toBe(false); expect(url).toBe('chrome-extension://fixture/options.html'); pageLoaded = true; events.push('page-loaded'); },
    evaluate: replacement.evaluate, close: async () => events.push('close-wake-page'),
  };
  const ctxInfo = { worker: previous, extensionId: 'fixture', ctx: {
    waitForEvent: (name, options) => {
      expect(name).toBe('serviceworker'); expect(options.predicate(replacement)).toBe(true);
      expect(options.predicate(previous)).toBe(false); expect(options.predicate({ url: () => 'https://foreign.invalid/sw.js' })).toBe(false);
      return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Dormant worker was never explicitly woken')), 100); emitWorker = worker => { clearTimeout(timer); resolve(worker); }; });
    },
    newPage: async () => page, newCDPSession: async target => { expect(target).toBe(page); return cdp; },
  } };
  const install = runInNewContext(`(${functionSource('installDraftContextAndRestartWorker', 'openPanel')})`, {
    bounded: async operation => operation(), waitFor: async predicate => { for (let attempt = 0; attempt < 3; attempt++) { if (await predicate()) return; deferredVersion?.(); } throw new Error('Readiness never arrived'); },
    URL, results: { progress: [] }, diagnostics: { write: async () => {} }, save: async () => {}, check: (condition, message) => { if (!condition) throw new Error(message); },
  });
  await install(ctxInfo, '1700000000009');
  expect(ctxInfo.worker).toBe(replacement);
  expect(events.indexOf('ServiceWorker.stopWorker')).toBeGreaterThan(events.indexOf('page-loaded'));
  expect(events.indexOf('explicit-wake')).toBeGreaterThan(events.indexOf('old-closed'));
  expect(events).toContain('detach'); expect(events).toContain('close-wake-page');
  expect(memory.draftId).toBe('1700000000009'); expect(stored.draftStatus.draftId).toBe('1700000000009');
});

test('CDP resource type does not overwrite the diagnostic event name', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ui-diagnostics-'));
  const page = Object.assign(new EventEmitter(), { url: () => 'about:blank' });
  const cdp = Object.assign(new EventEmitter(), { send: async () => ({}) });
  const diagnostics = createDiagnostics(directory);
  await diagnostics.attach(page, { newCDPSession: async () => cdp }, 'test');
  cdp.emit('Network.requestWillBeSent', { type: 'Document', request: { url: 'http://localhost/draft', method: 'GET' }, initiator: { type: 'script', stack: { callFrames: [{ url: '/@vite/client' }] } } });
  cdp.emit('Page.frameNavigated', { type: 'Navigation', frame: { url: 'http://localhost/draft' } });
  await diagnostics.flush();
  const events = (await readFile(path.join(directory, 'browser.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(events[1].type).toBe('Network.requestWillBeSent');
  expect(events[1].cdpType).toBe('Document');
  expect(events[1].initiator.stack.callFrames[0].url).toBe('/@vite/client');
  expect(events[2].type).toBe('Page.frameNavigated');
  expect(events[2].cdpType).toBe('Navigation');
});

test('a separate iframe CDP session retains an unprompted navigation initiator stack', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ui-iframe-cdp-'));
  const frame = { url: () => 'http://localhost:3000/sidepanel' };
  const cdp = Object.assign(new EventEmitter(), { send: async () => ({}) });
  const diagnostics = createDiagnostics(directory);
  await diagnostics.attachFrame(frame, { newCDPSession: async target => { expect(target).toBe(frame); return cdp; } }, 'panel');
  cdp.emit('Network.requestWillBeSent', { type: 'Document', request: { url: frame.url(), method: 'GET' },
    initiator: { type: 'script', stack: { callFrames: [{ functionName: 'reload', url: '/assets/app.js', lineNumber: 12 }] } } });
  await diagnostics.flush();
  const events = (await readFile(path.join(directory, 'browser.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(events[0].type).toBe('iframe-attached');
  expect(events[1].type).toBe('Network.requestWillBeSent');
  expect(events[1].cdpType).toBe('Document');
  expect(events[1].initiator.stack.callFrames[0]).toMatchObject({ url: '/assets/app.js', lineNumber: 12 });
});

test('only the documented shared-session error permits using the parent iframe CDP capture', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ui-shared-cdp-'));
  const diagnostics = createDiagnostics(directory);
  await expect(diagnostics.attachFrame({ url: () => 'http://localhost/sidepanel' }, { newCDPSession: async () => {
    throw new Error("This frame does not have a separate CDP session, it is a part of the parent frame's session");
  } }, 'panel')).resolves.toBeUndefined();
  await expect(diagnostics.attachFrame({ url: () => 'http://localhost/sidepanel' }, { newCDPSession: async () => {
    throw new Error('Protocol disconnected');
  } }, 'panel')).rejects.toThrow('Protocol disconnected');
});


test('a failed mock burst stops the full scenario before any stress commands start', async () => {
  const setup = { close: async () => {} };
  const ctxInfo = { ctx: { newPage: async () => ({ goto: async () => {}, close: async () => {} }) } };
  const scenario = { label: 'tabs', bursts: {} };
  let stressStarted = false;
  const positive = runInNewContext(`(${functionSource('positiveScenario', 'pickConflict')})`, {
    config: { perActor: 300, suites: 3, seeds: 5, bursts: true }, SCENARIOS: ['tabs'], draftIds: () => ['1700000000009'],
    launch: async () => ctxInfo, context: { newPage: async () => setup },
    seedV1: async () => {}, activateThroughPrompt: async () => ({ completed: true, v1Snapshot: [] }),
    origin: 'http://localhost', appState: async () => 'app', save: async () => {},
    mockBurst: async () => ({ checks: { good: false, message: 'mock player selection failed' } }),
    check: (condition, message) => { if (!condition) throw new Error(message); },
    loadCatalog: async () => { stressStarted = true; throw new Error('Stress started after failed burst'); },
  });
  await expect(positive(scenario, 0)).rejects.toThrow('mock auto-advance burst failed');
  expect(stressStarted).toBe(false);
});

test('setup-only has zero workload and cannot be widened into a matrix or diagnostic replay', () => {
  const mode = runnerMode(['--extension-setup-only', '--browser-authorized']);
  expect(mode.extensionSetupOnly).toBe(true);
  expect(mode.workload).toEqual({ suites: 0, seeds: 0, perActor: 0, pickConflicts: 0, moveConflicts: 0,
    bursts: false, control: false, lifecycle: false, burstPicksPerActor: 0 });
  for (const flag of ['--gate', '--tier2', '--smoke', '--focused-navigation', '--plan', '--prepare-production', '--scenarios=tabs']) {
    expect(() => runnerMode(['--extension-setup-only', flag])).toThrow('another runner scope');
  }
  expect(runnerMode(['--gate']).workload).toEqual({});
});

function navigationFixture() {
  const defects = [];
  const guard = createNavigationGuard({ origin: 'http://localhost:3000', onDefect: defect => defects.push(defect) });
  const main = { url: () => 'http://localhost:3000/draft' };
  const child = { url: () => 'http://localhost:3000/sidepanel' };
  const page = { mainFrame: () => main };
  const request = (url, frame = main, document = true) => ({ url: () => url, frame: () => frame,
    isNavigationRequest: () => document, resourceType: () => document ? 'document' : 'fetch' });
  return { guard, page, main, child, request, defects };
}

test('runner goto and reload each authorize one matching document, including a mounted iframe', async () => {
  const { guard, page, child, request, defects } = navigationFixture();
  const url = 'chrome-extension://fixture/sidepanel.html';
  for (const reason of ['runner goto', 'runner reload']) {
    guard.expectPanel(page, '123');
    await guard.navigate(page, reason, url, async () => {
      expect(guard.observe(page, request(url))).toEqual({ expected: reason });
    });
    expect(guard.observe(page, request('http://localhost:3000/sidepanel?draftId=123&__storageNonce=fresh', child))).toEqual({ expected: 'storage-sharing iframe mount' });
    guard.panelReady(page);
  }
  expect(defects).toEqual([]);
});

test.each(['http://localhost:3000/draft', 'http://localhost:3000/sidepanel?draftId=123&__storageNonce=fresh'])('unprompted production document requests stop once, url=%s', async url => {
  const { guard, page, child, request, defects } = navigationFixture();
  const frame = url.includes('sidepanel') ? child : page.mainFrame();
  expect(guard.observe(page, request(url, frame)).defect.message).toContain('STOP product defect');
  guard.observe(page, request(url, frame));
  expect(defects).toHaveLength(1);
  await expect(guard.navigate(page, 'runner reload', url, async () => {})).rejects.toThrow('STOP product defect');
});

test('history changes and ordinary fetches do not report a document replacement', async () => {
  const { guard, page, request, defects } = navigationFixture();
  const directory = await mkdtemp(path.join(tmpdir(), 'ui-history-'));
  const emitter = Object.assign(new EventEmitter(), page, { url: () => 'http://localhost:3000/draft' });
  const cdp = Object.assign(new EventEmitter(), { send: async () => ({}) });
  const diagnostics = createDiagnostics(directory, { navigation: guard });
  await diagnostics.attach(emitter, { newCDPSession: async () => cdp }, 'history');
  cdp.emit('Page.navigatedWithinDocument', { frameId: 'main', url: 'http://localhost:3000/draft?draftId=123', navigationType: 'historyApi' });
  emitter.emit('request', request('http://localhost:3000/api/sync', page.mainFrame(), false));
  await diagnostics.flush();
  expect(defects).toEqual([]);
  expect(await readFile(path.join(directory, 'browser.ndjson'), 'utf8')).toContain('Page.navigatedWithinDocument');
});

test('a second reload during a runner goto and a production helper URL both fail', async () => {
  const { guard, page, request, defects } = navigationFixture();
  const url = 'http://localhost:3000/draft';
  await guard.navigate(page, 'runner goto', url, async () => {
    guard.observe(page, request(url));
    expect(guard.observe(page, request(url)).defect).toBeTruthy();
  });
  expect(defects).toHaveLength(1);
  const separate = navigationFixture();
  separate.guard.expectPanel(separate.page, '123');
  expect(separate.guard.observe(separate.page, separate.request('http://localhost:3000/?__storageProbe=nonce')).defect).toBeTruthy();
});

test.each([false, true])('setup-only retains an ordinary app tab, audits iframe storage and rejects a reused reload nonce, reused=%s', async reused => {
  const canonical = 'http://localhost:3000/draft';
  const stored = { draftStatus: { draftId: '1700000100009' } };
  const committed = { present: true, picks: [], queue: [], revision: 1 };
  const ctx = { url: () => 'http://localhost:3000/sidepanel?__storageNonce=first' };
  const panel = { ctx, page: { screenshot: async () => {} } };
  let closed = false;
  const setup = { url: () => canonical, close: async () => { closed = true; } };
  const ctxInfo = { runtime: { manifest: { manifest_version: 3 } }, ctx: { newPage: async () => setup },
    worker: { evaluate: async (_fn, arg) => arg ? true : stored } };
  const results = { progress: [{ stage: 'extension-worker-explicitly-woken', id: stored.draftStatus.draftId, oldClosed: true, newWorker: true }] };
  const run = runInNewContext(`(${functionSource('focusedExtensionSetup', 'positiveScenario')})`, {
    URL, origin: 'http://localhost:3000', currentLabel: '', outDir: '/unused', path, results,
    launch: async () => ctxInfo, seedV1: async () => {}, activateThroughPrompt: async () => ({ completed: true }),
    openPanel: async () => { expect(closed).toBe(false); return panel; },
    readCommitted: async target => { expect(target).toBe(ctx); return committed; },
    reloadActors: async () => { expect(closed).toBe(false); ctx.url = () => `http://localhost:3000/sidepanel?__storageNonce=${reused ? 'first' : 'second'}`; },
    save: async () => {}, check: (condition, message) => { if (!condition) throw new Error(message); },
  });
  if (reused) { await expect(run()).rejects.toThrow('Independent extension setup failed'); return; }
  await run();
  expect(results.extensionSetup.ready).toBe(true);
  expect(results.extensionSetup.workloadCommands).toBe(0);
  expect(results.extensionSetup.canonicalAppTab).toBe(canonical);
  expect(results.extensionSetup.nonceBefore).not.toBe(results.extensionSetup.nonceAfter);
});
