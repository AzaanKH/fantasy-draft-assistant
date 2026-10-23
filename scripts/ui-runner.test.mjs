import { test, expect } from 'vitest';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createDiagnostics, createNavigationGuard } from './persistence/ui-diagnostics.mjs';
import { conflictDialog } from './persistence/fixtures/conflict-dialog.mjs';
import { prepareConflict, submitConflict, auditObservedConflict } from './persistence/ui-conflict.mjs';
import { runnerMode } from './persistence/ui-runner-mode.mjs';
import { resetExtensionWorker, workerResetPasses } from './persistence/ui-worker.mjs';
import { workerProtocol } from './persistence/fixtures/worker-protocol.mjs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { auditSession, sessionPasses, auditPickConflict } from './persistence/ui-adapter.mjs';

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

const missingCloseTrace = JSON.parse(await readFile(new URL('./persistence/fixtures/worker-stop-without-close.json', import.meta.url), 'utf8'));
test.each([
  { newTarget: false, delayedHydration: false }, { newTarget: true, delayedHydration: false },
  { newTarget: false, delayedHydration: true }, { newTarget: true, delayedHydration: true },
  { newTarget: false, delayedHydration: false, delayedVersion: true },
])('observed stopped then explicit wake resets the worker realm without Worker.close or a replacement event, newTarget=$newTarget delayedHydration=$delayedHydration delayedVersion=$delayedVersion', async options => {
  const fixture = workerProtocol(missingCloseTrace, options);
  const proof = await resetExtensionWorker(fixture.ctxInfo, '1700000000009', fixture.options);
  expect(workerResetPasses(proof)).toBe(true);
  expect(proof.oldClosedDiagnostic).toBe(false);
  expect(proof.targetReused).toBe(!options.newTarget);
  expect(proof.before.contextUniqueId).not.toBe(proof.after.contextUniqueId);
  expect(proof.before.sentinelPresent).toBe(true); expect(proof.after.sentinelPresent).toBe(false);
  expect(fixture.ctxInfo.worker).not.toBe(fixture.previous);
  expect(fixture.ctxInfo.worker.contextUniqueId).toBe(proof.after.contextUniqueId);
  expect(fixture.events.indexOf('explicit-wake')).toBeGreaterThan(fixture.events.indexOf('cdp-stopped'));
  expect(fixture.events).not.toContain('stale-wrapper-evaluate');
  expect(await fixture.ctxInfo.worker.evaluate(async () => (await chrome.storage.local.get('draftStatus')).draftStatus.draftId)).toBe('1700000000009');
  expect(fixture.events).toContain('page-cdp-detached'); expect(fixture.events).toContain('wake-page-closed');
  await fixture.ctxInfo.worker.dispose();
  await expect(fixture.ctxInfo.worker.evaluate(() => true)).rejects.toThrow('Disposed worker runtime');
  expect(fixture.sessions.size).toBe(0);
});

test.each([
  ['foreignWorker', 'foreign extension worker'], ['foreignOnly', 'was not reported'], ['ambiguous', 'Ambiguous active versions'],
  ['noVersion', 'was not reported'], ['foreignTarget', 'does not match'],
])('refuses %s before stopping any worker', async (option, message) => {
  const fixture = workerProtocol(missingCloseTrace, { [option]: true });
  await expect(resetExtensionWorker(fixture.ctxInfo, '1700000000009', fixture.options)).rejects.toThrow(message);
  expect(fixture.events).not.toContain('targeted-stop'); expect(fixture.events).not.toContain('explicit-wake');
  expect(fixture.ctxInfo.worker).toBe(fixture.previous); expect(fixture.sessions.size).toBe(0);
});

test.each([
  ['noStopped', 'did not report stopped'], ['foreignStopped', 'did not report stopped'],
  ['noRunning', 'did not report the owned worker running'], ['changedRegistration', 'exact owned version and registration'],
  ['unchangedRealm', 'realm was not reset'], ['unchangedContext', 'realm was not reset'],
  ['missingSeed', 'hydrated seed proof is incomplete'], ['noContext', 'execution context was not reported'],
  ['rpcTimeout', 'Runtime.enable on owned worker timed out'], ['wakeTimeout', 'GET_DRAFT_STATUS wake timed out'],
])('fails %s and never publishes or evaluates a stale worker handle', async (option, message) => {
  const fixture = workerProtocol(missingCloseTrace, { [option]: true });
  await expect(resetExtensionWorker(fixture.ctxInfo, '1700000000009', fixture.options)).rejects.toThrow(message);
  expect(fixture.ctxInfo.worker).toBeNull(); expect(fixture.events).not.toContain('stale-wrapper-evaluate');
  if (['noStopped', 'foreignStopped'].includes(option)) expect(fixture.events).not.toContain('explicit-wake');
  expect(fixture.events).toContain('wake-page-closed'); expect(fixture.sessions.size).toBe(0);
});

test('a retained target cannot pass raw reset evidence with no stop, no realm reset, wrong registration or an unhydrated seed', async () => {
  const fixture = workerProtocol(missingCloseTrace);
  const proof = await resetExtensionWorker(fixture.ctxInfo, '1700000000009', fixture.options);
  for (const mutate of [
    row => row.stopped.runningStatus = 'stopping', row => row.stopped.targetId = row.owned.targetId,
    row => row.running.sequence = row.wakeSequence, row => row.running.registrationId = 'foreign',
    row => row.after.sentinelPresent = true, row => row.after.contextUniqueId = row.before.contextUniqueId,
    row => row.after.targetId = 'foreign', row => row.after.stored.draftStatus.draftId = 'wrong',
  ]) { const row = structuredClone(proof); mutate(row); expect(workerResetPasses(row)).toBe(false); }
  expect(workerResetPasses(undefined)).toBe(false);
  await fixture.ctxInfo.worker.dispose();
});

test('a verified CDP handle refuses evaluation after its execution context disappears', async () => {
  const fixture = workerProtocol(missingCloseTrace);
  await resetExtensionWorker(fixture.ctxInfo, '1700000000009', fixture.options);
  const sessionId = [...fixture.sessions.keys()][0];
  fixture.root.emit('Target.receivedMessageFromTarget', { sessionId, message: JSON.stringify({ method: 'Runtime.executionContextsCleared', params: {} }) });
  await expect(fixture.ctxInfo.worker.evaluate(() => true)).rejects.toThrow('Stale owned worker execution context');
  await fixture.ctxInfo.worker.dispose();
});

test.each([false, true])('target identity cannot substitute for an erased volatile sentinel, newTarget=%s', async newTarget => {
  const fixture = workerProtocol(missingCloseTrace, { newTarget, unchangedRealm: true });
  await expect(resetExtensionWorker(fixture.ctxInfo, '1700000000009', fixture.options)).rejects.toThrow('realm was not reset');
  expect(fixture.ctxInfo.worker).toBeNull();
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
  const fixture = workerProtocol(missingCloseTrace);
  const reset = await resetExtensionWorker(fixture.ctxInfo, stored.draftStatus.draftId, fixture.options);
  await fixture.ctxInfo.worker.dispose();
  const results = { progress: [reset] };
  const run = runInNewContext(`(${functionSource('focusedExtensionSetup', 'positiveScenario')})`, {
    workerResetPasses, URL, origin: 'http://localhost:3000', currentLabel: '', outDir: '/unused', path, results,
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


const fillConflict = async (dialog, cmd) => {
  await dialog.getByLabel('Observed player').selectOption({ value: cmd.playerId });
  await dialog.getByLabel('Team and draft position').selectOption({ value: String(cmd.slot) });
};
const conflictCommands = [{ id: 'c:0', slot: 1, playerId: 'p1' }, { id: 'c:1', slot: 1, playerId: 'p2' }];
function dialogsForConflict({ retarget = false, reducerReject = false } = {}) {
  const document = new JSDOM('<body></body>').window.document;
  const loser = conflictDialog(document, 'p2', () => { if (reducerReject) loser.alert.textContent = 'Pick slot is already occupied'; else loser.node.remove(); }, () => { if (retarget) loser.slot.value = '2'; });
  const winner = conflictDialog(document, 'p1', () => {
    winner.node.remove();
    if (!retarget && !reducerReject) { loser.slot.value = ''; loser.button.disabled = true; loser.alert.textContent = 'Pick 1 was just recorded elsewhere. Choose a pick.'; }
  });
  return [winner, loser];
}

test('a conflict loser cleared and disabled after the winner is observed without waiting on its disabled click', async () => {
  const views = dialogsForConflict(); const dialogs = views.map(value => value.dialog);
  const run = runInNewContext(`(${functionSource('pickConflict', 'moveConflict')})`, {
    startSession: async () => dialogs.map((dialog, i) => ({ name: `tab${i}`, page: {}, ctx: dialog })),
    openPickDialog: async dialog => dialog, fillPick: fillConflict, prepareConflict, submitConflict, auditObservedConflict,
    recordAction: async (_actor, cmd, operation) => ({ cmd, ...await operation() }), results: { progress: [] }, save: async () => {},
    sleep: async () => {}, reloadActors: async () => {}, readCommitted: async () => ({ picks: [{ pickNumber: 1, playerId: 'p1' }], queue: [] }), closeActors: async () => {},
  });
  const row = await run({}, 'draft', [{ id: 'p1' }, { id: 'p2' }], 1, false);
  expect(row.checks.good).toBe(true); expect(row.results[1].rejectionKind).toBe('invalidated-selection');
  expect(row.barrier.map(value => value.slot)).toEqual(['1', '1']);
});

test.each([false, true])('both actual dialogs select the intended slot before release, reducerReject=%s', async reducerReject => {
  const views = dialogsForConflict({ reducerReject }); const dialogs = views.map(value => value.dialog);
  const prepared = await prepareConflict(dialogs, conflictCommands, fillConflict);
  expect(prepared.barrier.map(value => [value.slot, value.player])).toEqual([['1', 'p1'], ['1', 'p2']]);
  const outcomes = await Promise.all(dialogs.map(async (dialog, index) => ({ cmd: conflictCommands[index], ...await submitConflict(dialog, conflictCommands[index], prepared.barrier[index], prepared.observers[index]) })));
  const row = { slot: 1, players: ['p1', 'p2'], barrier: prepared.barrier, results: outcomes, committed: { picks: [{ pickNumber: 1, playerId: 'p1' }] } };
  expect(auditObservedConflict(row).good).toBe(true);
  expect(outcomes[1].rejectionKind).toBe(reducerReject ? 'submitted-command' : 'invalidated-selection');
  await Promise.all(prepared.observers.map(observer => observer.dispose()));
});

test('a slot retarget at the actual click is captured even when its dialog immediately closes', async () => {
  const views = dialogsForConflict({ retarget: true }); const dialogs = views.map(value => value.dialog);
  const prepared = await prepareConflict(dialogs, conflictCommands, fillConflict);
  const outcomes = await Promise.all(dialogs.map(async (dialog, index) => ({ cmd: conflictCommands[index], ...await submitConflict(dialog, conflictCommands[index], prepared.barrier[index], prepared.observers[index]) })));
  expect(outcomes[1].outcome).toBe('error'); expect(outcomes[1].observations.final.clicks[0].slot).toBe('2');
  await Promise.all(prepared.observers.map(observer => observer.dispose()));
});

test('an actor which never selected the intended slot cannot count as an explicit loser', async () => {
  const views = dialogsForConflict(); const dialogs = views.map(value => value.dialog);
  await expect(prepareConflict(dialogs, conflictCommands, async (dialog, cmd) => fillConflict(dialog, { ...cmd, slot: 2 }))).rejects.toThrow('barrier did not select');
});

test('a stale or misleading loser alert cannot replace a verified intended selection', async () => {
  const views = dialogsForConflict(); const dialogs = views.map(value => value.dialog);
  const prepared = await prepareConflict(dialogs, conflictCommands, fillConflict);
  views[1].slot.value = ''; views[1].button.disabled = true; views[1].alert.textContent = 'Choose a player';
  const outcome = await submitConflict(dialogs[1], conflictCommands[1], prepared.barrier[1], prepared.observers[1]);
  expect(outcome.outcome).toBe('error');
  await expect(submitConflict(dialogs[1], conflictCommands[1], { ...prepared.barrier[1], slot: '2' }, prepared.observers[1])).rejects.toThrow('never selected');
  await Promise.all(prepared.observers.map(observer => observer.dispose()));
});


test('root Tier 2 smoke is exactly 150 commands per actor with no full-matrix or extra-scope flags', () => {
  const mode = runnerMode(['--root-tier2-smoke', '--browser-authorized']);
  expect(mode.rootTier2Smoke).toBe(true);
  expect(mode.workload).toMatchObject({ suites: 1, seeds: 1, perActor: 150, pickConflicts: 20, moveConflicts: 20, control: false, bursts: false, lifecycle: true });
  for (const flag of ['--gate', '--tier2', '--smoke', '--extension-setup-only', '--focused-navigation', '--scenarios=tabs']) {
    expect(() => runnerMode(['--root-tier2-smoke', flag])).toThrow('another runner scope');
  }
});
