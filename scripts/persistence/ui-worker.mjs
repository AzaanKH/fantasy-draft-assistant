import { randomUUID } from 'node:crypto';

async function timed(operation, timeoutMs, label) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  })]); } finally { clearTimeout(timer); }
}

function waitFor(select, subscribe, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => finish(new Error(message)), timeoutMs);
    function finish(error, value) { clearTimeout(timer); unsubscribe(); if (error) reject(error); else resolve(value); }
    const poll = () => { try { const value = select(); if (value) finish(null, value); } catch (error) { finish(error); } };
    unsubscribe = subscribe(poll);
    poll();
  });
}

async function targetRuntime(root, targetId, scriptURL, timeoutMs, log) {
  const { sessionId } = await root.send('Target.attachToTarget', { targetId, flatten: false });
  const pending = new Map(); const contexts = new Map(); const changed = new Set();
  let serial = 0; let disposed = false;
  const rejectPending = error => { for (const call of pending.values()) call.finish(error); };
  const receive = event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if ('id' in message) {
      const call = pending.get(message.id);
      if (call) call.finish(message.error ? new Error(message.error.message) : null, message.result);
      return;
    }
    log({ type: 'runner-worker-runtime', targetId, sessionId, method: message.method, params: message.params });
    if (message.method === 'Runtime.executionContextsCleared') contexts.clear();
    if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(message.params.executionContextId);
    if (message.method === 'Runtime.executionContextCreated') contexts.set(message.params.context.id, message.params.context);
    for (const poll of [...changed]) poll();
  };
  const detached = event => { if (event.sessionId === sessionId) rejectPending(new Error('Owned worker target session detached')); };
  root.on('Target.receivedMessageFromTarget', receive); root.on('Target.detachedFromTarget', detached);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (disposed) { reject(new Error('Disposed worker runtime')); return; }
    const id = ++serial;
    const timer = setTimeout(() => finish(new Error(`${method} on owned worker timed out`)), timeoutMs);
    function finish(error, result) { clearTimeout(timer); pending.delete(id); if (error) reject(error); else resolve(result); }
    pending.set(id, { finish });
    root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(finish);
  });
  const dispose = async () => {
    if (disposed) return;
    disposed = true; rejectPending(new Error('Disposed worker runtime'));
    root.off('Target.receivedMessageFromTarget', receive); root.off('Target.detachedFromTarget', detached);
    await root.send('Target.detachFromTarget', { sessionId });
  };
  try {
    const { targetInfo } = await root.send('Target.getTargetInfo', { targetId });
    if (targetInfo.type !== 'service_worker' || targetInfo.url !== scriptURL) throw new Error('CDP target does not match the owned worker script');
    await send('Runtime.enable');
    const context = await waitFor(() => {
      const live = [...contexts.values()].filter(value => value.auxData?.isDefault !== false);
      if (live.length > 1) throw new Error('Ambiguous worker execution contexts');
      return live[0]?.uniqueId ? live[0] : undefined;
    }, poll => { changed.add(poll); return () => changed.delete(poll); }, timeoutMs, 'Owned worker execution context was not reported');
    return { targetId, contextUniqueId: context.uniqueId, url: () => scriptURL, dispose,
      evaluate: async (fn, arg) => {
        if (!contexts.has(context.id) || contexts.get(context.id).uniqueId !== context.uniqueId) throw new Error('Stale owned worker execution context');
        const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${arg === undefined ? 'undefined' : JSON.stringify(arg)})`,
          uniqueContextId: context.uniqueId, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      } };
  } catch (error) { await dispose(); throw error; }
}

const sameVersion = (left, right) => left?.versionId === right?.versionId && left?.registrationId === right?.registrationId && left?.scriptURL === right?.scriptURL;
const seeded = (status, id) => status?.draftId === id && status.provider === 'sleeper' && status.isInDraftRoom === true && status.myDraftSlot === 1;
export function workerResetPasses(proof) {
  return !!proof?.owned && !!proof.stopped && !!proof.running && !!proof.before && !!proof.after && sameVersion(proof.owned, proof.stopped) && sameVersion(proof.owned, proof.running) &&
    !!proof.owned.registrationId && !!proof.owned.targetId && proof.stopped.runningStatus === 'stopped' && !proof.stopped.targetId &&
    proof.stopped.sequence > proof.stopSequence && proof.wakeSequence >= proof.stopped.sequence && proof.running.sequence > proof.wakeSequence &&
    proof.running.runningStatus === 'running' && !!proof.running.targetId && proof.before.sentinelPresent === true &&
    !!proof.before.contextUniqueId && !!proof.after.contextUniqueId && proof.before.contextUniqueId !== proof.after.contextUniqueId &&
    proof.after.targetId === proof.running.targetId && proof.after.sentinelPresent === false &&
    seeded(proof.wakeResponse?.data?.status, proof.id) && proof.wakeResponse.success === true && seeded(proof.after.stored?.draftStatus, proof.id);
}

export async function resetExtensionWorker(ctxInfo, id, { log = () => {}, timeoutMs = 10000 } = {}) {
  const previous = ctxInfo.worker; const scriptURL = previous.url();
  if (new URL(scriptURL).protocol !== 'chrome-extension:' || new URL(scriptURL).hostname !== ctxInfo.extensionId) throw new Error('Refusing to stop a foreign extension worker');
  const emit = event => { void log(event); };
  const wakePage = await ctxInfo.ctx.newPage();
  let cdp; let root; let runtime; let keepRuntime = false; let oldClosedDiagnostic = false;
  const onClose = () => { oldClosedDiagnostic = true; };
  previous.on?.('close', onClose);
  try {
    await wakePage.goto(`chrome-extension://${ctxInfo.extensionId}/options.html`);
    cdp = await ctxInfo.ctx.newCDPSession(wakePage);
    const browserSession = await timed(() => ctxInfo.ctx.browser().newBrowserCDPSession(), timeoutMs, 'Open browser CDP session');
    root = { send: (method, params) => timed(() => browserSession.send(method, params), timeoutMs, method),
      on: browserSession.on.bind(browserSession), off: browserSession.off.bind(browserSession), detach: () => browserSession.detach() };
    const versions = new Map(); const changed = new Set();
    let sequence = 0;
    cdp.on('ServiceWorker.workerVersionUpdated', event => {
      for (const version of event.versions) versions.set(version.versionId, { ...version, sequence: ++sequence });
      emit({ type: 'ServiceWorker.workerVersionUpdated', ...event });
      for (const poll of [...changed]) poll();
    });
    const wait = (select, message) => waitFor(select, poll => { changed.add(poll); return () => changed.delete(poll); }, timeoutMs, message);
    const running = () => {
      const live = [...versions.values()].filter(version => version.scriptURL === scriptURL && ['starting', 'running', 'stopping'].includes(version.runningStatus));
      if (live.length > 1) throw new Error('Ambiguous active versions for the owned extension worker');
      return live[0]?.runningStatus === 'running' && live[0].targetId && live[0].registrationId ? live[0] : undefined;
    };
    await timed(() => cdp.send('ServiceWorker.enable'), timeoutMs, 'ServiceWorker.enable');
    const owned = await wait(running, 'Owned extension worker version was not reported by CDP');
    runtime = await targetRuntime(root, owned.targetId, scriptURL, timeoutMs, emit);
    const sentinelKey = `__ui_worker_realm_${randomUUID()}`;
    const sentinelValue = randomUUID();
    const before = await runtime.evaluate(async ({ id, sentinelKey, sentinelValue }) => {
      globalThis[sentinelKey] = sentinelValue;
      await chrome.storage.local.set({ draftStatus: { isInDraftRoom: true, provider: 'sleeper', draftId: id, myDraftSlot: 1 } });
      return { sentinelPresent: Object.hasOwn(globalThis, sentinelKey), sentinelValue: globalThis[sentinelKey], scriptURL: location.href };
    }, { id, sentinelKey, sentinelValue });
    before.contextUniqueId = runtime.contextUniqueId;
    if (before.sentinelValue !== sentinelValue || before.scriptURL !== scriptURL) throw new Error('Old worker realm sentinel was not established');
    await runtime.dispose(); runtime = undefined;
    ctxInfo.worker = null;
    await previous.dispose?.();
    const stopSequence = sequence;
    emit({ type: 'runner-worker-stop', id, ...owned });
    await timed(() => cdp.send('ServiceWorker.stopWorker', { versionId: owned.versionId }), timeoutMs, 'ServiceWorker.stopWorker');
    const stopped = await wait(() => {
      const value = versions.get(owned.versionId);
      if (!sameVersion(value, owned)) throw new Error('Owned worker version identity changed during stop');
      return value.sequence > stopSequence && value.runningStatus === 'stopped' && !value.targetId ? value : undefined;
    }, 'Owned worker did not report stopped with its target absent');
    const wakeSequence = sequence;
    emit({ type: 'runner-worker-explicit-wake', id, scriptURL, versionId: owned.versionId, registrationId: owned.registrationId, stopped, wakeSequence });
    const readStatus = () => timed(() => wakePage.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_DRAFT_STATUS' })), timeoutMs, 'Explicit GET_DRAFT_STATUS wake');
    let response = await readStatus();
    const firstWakeResponse = response;
    const restarted = await wait(() => {
      const value = running();
      if (value && !sameVersion(value, owned)) throw new Error('Woken worker does not match the exact owned version and registration');
      return value?.sequence > wakeSequence ? value : undefined;
    }, 'Explicit wake did not report the owned worker running');
    runtime = await targetRuntime(root, restarted.targetId, scriptURL, timeoutMs, emit);
    const after = await runtime.evaluate(async key => ({ sentinelPresent: Object.hasOwn(globalThis, key),
      stored: await chrome.storage.local.get('draftStatus'), scriptURL: location.href }), sentinelKey);
    after.contextUniqueId = runtime.contextUniqueId; after.targetId = runtime.targetId;
    if (after.sentinelPresent || before.contextUniqueId === after.contextUniqueId || after.scriptURL !== scriptURL) throw new Error('Worker realm was not reset after the observed stop and wake');
    const deadline = Date.now() + timeoutMs;
    while (!seeded(response?.data?.status, id) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      response = await readStatus();
    }
    const proof = { stage: 'extension-worker-explicitly-woken', id, owned, stopped, running: restarted, stopSequence, wakeSequence, before, after,
      firstWakeResponse, wakeResponse: response, oldClosedDiagnostic, targetReused: restarted.targetId === owned.targetId, at: new Date().toISOString() };
    if (!workerResetPasses(proof)) throw new Error('Owned worker reset or hydrated seed proof is incomplete');
    const target = runtime; const rootSession = root;
    ctxInfo.worker = { ...target, dispose: async () => { try { await target.dispose(); } finally { await rootSession.detach(); } } };
    keepRuntime = true;
    emit(proof);
    return proof;
  } finally {
    previous.off?.('close', onClose);
    try { if (!keepRuntime) { try { await runtime?.dispose(); } finally { await root?.detach(); } } }
    finally { try { await cdp?.detach(); } finally { await wakePage.close(); } }
  }
}
