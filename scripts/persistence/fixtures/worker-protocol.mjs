import { EventEmitter } from 'node:events';
import { createContext, runInContext, runInNewContext } from 'node:vm';

export function workerProtocol(trace, options = {}) {
  const initial = trace.find(event => event.type === 'ServiceWorker.workerVersionUpdated').versions[0];
  const stopped = trace.filter(event => event.type === 'ServiceWorker.workerVersionUpdated').at(-1).versions[0];
  const events = []; const stored = {}; const log = [];
  let pageLoaded = false; let didStop = false; let didWake = false; let memory = { draftId: 'old-worker-memory' };
  let contextSerial = 1;
  const scriptURL = initial.scriptURL;
  const storage = { set: async values => Object.assign(stored, values), get: async () => structuredClone(stored) };
  const makeRealm = () => createContext({ chrome: { storage: { local: storage } }, location: { href: scriptURL } });
  let realm = makeRealm();
  let live = { ...initial }; let context = { id: 1, uniqueId: 'realm-1', auxData: { isDefault: true } };
  const cdp = new EventEmitter();
  const publish = versions => cdp.emit('ServiceWorker.workerVersionUpdated', { versions: structuredClone(versions) });
  cdp.send = async (method, args) => {
    events.push(method);
    if (method === 'ServiceWorker.enable') {
      if (!pageLoaded) throw new Error('Version discovery ran before the registered page loaded');
      if (options.noVersion) return {};
      if (options.delayedVersion) { setTimeout(() => publish([initial]), 0); return {}; }
      const rows = options.foreignOnly ? [{ ...initial, scriptURL: 'https://foreign.invalid/sw.js' }] : [initial];
      if (options.ambiguous) rows.push({ ...initial, versionId: 'other', targetId: 'foreign-target' });
      publish(rows); return {};
    }
    if (method !== 'ServiceWorker.stopWorker' || args.versionId !== initial.versionId) throw new Error('Refusing an unexpected or foreign worker stop');
    if (!stored.draftStatus || !Object.keys(realm).some(key => key.startsWith('__ui_worker_realm_'))) throw new Error('Seed and volatile sentinel were not established before stop');
    events.push('targeted-stop'); didStop = true;
    publish([{ ...initial, runningStatus: 'stopping' }]);
    if (!options.noStopped) {
      live = { ...stopped };
      publish([options.foreignStopped ? { ...stopped, versionId: 'foreign' } : stopped]);
      events.push('cdp-stopped');
    }
    return {};
  };
  cdp.detach = async () => events.push('page-cdp-detached');
  const root = new EventEmitter(); const sessions = new Map();
  root.send = async (method, args) => {
    events.push(method);
    if (method === 'Target.attachToTarget') {
      if (args.flatten !== false || args.targetId !== live.targetId) throw new Error('Attached to the wrong worker target');
      const sessionId = `session-${++contextSerial}`; sessions.set(sessionId, args.targetId); return { sessionId };
    }
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: args.targetId, type: 'service_worker', url: options.foreignTarget ? 'https://foreign.invalid/sw.js' : scriptURL } };
    if (method === 'Target.detachFromTarget') { sessions.delete(args.sessionId); root.emit('Target.detachedFromTarget', { sessionId: args.sessionId }); return {}; }
    if (method !== 'Target.sendMessageToTarget' || !sessions.has(args.sessionId)) throw new Error(`Unexpected target operation ${method}`);
    const message = JSON.parse(args.message);
    const emit = message => root.emit('Target.receivedMessageFromTarget', { sessionId: args.sessionId, message: JSON.stringify(message) });
    if (options.rpcTimeout && didWake) return {};
    let result;
    if (message.method === 'Runtime.enable') {
      if (!options.noContext || !didWake) emit({ method: 'Runtime.executionContextCreated', params: { context } });
      result = {};
    } else if (message.method === 'Runtime.evaluate') {
      if (message.params.uniqueContextId !== context.uniqueId) throw new Error('Attempted to evaluate a stale execution context');
      events.push(`evaluate:${context.uniqueId}`);
      try { result = { result: { value: await runInContext(message.params.expression, realm) } }; }
      catch (error) { result = { exceptionDetails: { text: error.message } }; }
    } else throw new Error(`Unexpected runtime operation ${message.method}`);
    queueMicrotask(() => emit({ id: message.id, result }));
    return {};
  };
  root.detach = async () => { sessions.clear(); events.push('browser-cdp-detached'); };
  const chrome = { runtime: { sendMessage: async message => {
    if (!pageLoaded || !didStop || live.runningStatus !== 'stopped' && !didWake || message.type !== 'GET_DRAFT_STATUS') throw new Error('Wake must follow a registered-page exact stopped state');
    if (options.wakeTimeout) return new Promise(() => {});
    events.push('explicit-wake');
    if (!didWake) {
      didWake = true;
      if (!options.unchangedRealm) realm = makeRealm();
      if (!options.unchangedContext) context = { id: 2, uniqueId: 'realm-2', auxData: { isDefault: true } };
      live = { ...initial, runningStatus: 'running', targetId: options.newTarget ? 'new-worker-target' : initial.targetId,
        registrationId: options.changedRegistration ? 'other-registration' : initial.registrationId };
      if (!options.noRunning) publish([live]);
      if (!options.delayedHydration) memory = structuredClone(stored.draftStatus);
      if (options.missingSeed) delete stored.draftStatus;
    } else memory = structuredClone(stored.draftStatus);
    return { success: true, data: { status: structuredClone(memory) } };
  } } };
  const page = { goto: async url => {
    if (didStop || url !== `chrome-extension://${new URL(scriptURL).hostname}/options.html`) throw new Error('Registered wake page must load before stopping');
    pageLoaded = true; events.push('page-loaded');
  }, evaluate: async (fn, arg) => runInNewContext(`(${fn.toString()})(arg)`, { chrome, arg }), close: async () => events.push('wake-page-closed') };
  const previous = Object.assign(new EventEmitter(), { url: () => options.foreignWorker ? 'chrome-extension://foreign/background.js' : scriptURL,
    evaluate: async () => { events.push('stale-wrapper-evaluate'); throw new Error('Never evaluate the cached Playwright worker context'); },
    waitForEvent: async () => { throw new Error('No Playwright Worker.close or replacement event is delivered'); } });
  const ctxInfo = { worker: previous, extensionId: new URL(scriptURL).hostname, ctx: {
    newPage: async () => page, newCDPSession: async () => cdp, browser: () => ({ newBrowserCDPSession: async () => root }),
    waitForEvent: async () => { throw new Error('No serviceworker replacement event is delivered'); },
  } };
  return { ctxInfo, previous, events, stored, sessions, root, log, options: { timeoutMs: 60, log: event => log.push(structuredClone(event)) } };
}
