import { appendFile } from 'node:fs/promises';
import path from 'node:path';

export function createNavigationGuard({ origin, onDefect }) {
  const expected = new WeakMap();
  const panels = new WeakMap();
  let failure;
  const documentUrl = value => { const url = new URL(value); url.hash = ''; return url.href; };
  const expectPanel = (page, id) => {
    panels.set(page, { id, frameUsed: false });
  };
  const panelReady = page => panels.delete(page);
  const observe = (page, request) => {
    if (!request.isNavigationRequest() || request.resourceType() !== 'document') return;
    const url = new URL(request.url());
    if (!['http:', 'https:', 'chrome-extension:'].includes(url.protocol)) return;
    const frame = request.frame();
    const main = frame === page.mainFrame();
    const token = expected.get(page);
    if (main && token && !token.used && documentUrl(url.href) === token.url) { token.used = true; return { expected: token.reason }; }
    const panel = panels.get(page);
    if (!main && panel && !panel.frameUsed && url.origin === origin && url.pathname === '/sidepanel' &&
        url.searchParams.get('draftId') === panel.id && url.searchParams.has('__storageNonce')) {
      panel.frameUsed = true; return { expected: 'storage-sharing iframe mount' };
    }
    if (!failure) {
      failure = { type: 'unprompted-production-navigation', url: url.href, frameUrl: frame.url(), mainFrame: main,
        message: `STOP product defect: unprompted production document navigation to ${url.href}` };
      onDefect(failure);
    }
    return { defect: failure };
  };
  const navigate = async (page, reason, url, operation) => {
    if (failure) throw new Error(failure.message);
    if (expected.has(page)) throw new Error('Overlapping runner navigation on one page');
    expected.set(page, { reason, url: documentUrl(url), used: false });
    try { return await operation(); } finally { expected.delete(page); }
  };
  return { observe, navigate, expectPanel, panelReady, failure: () => failure };
}

export function createDiagnostics(directory, { navigation } = {}) {
  let tail = Promise.resolve();
  const pages = new WeakMap();
  let pageIndex = 0;
  const write = (file, event) => {
    tail = tail.then(() => appendFile(path.join(directory, file), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'));
    return tail;
  };
  const server = (type, data = {}) => write('server.ndjson', { type, ...data });
  const captureProtocol = async (target, context, emit) => {
    const cdp = await context.newCDPSession(target);
    for (const type of ['Page.frameRequestedNavigation', 'Page.frameScheduledNavigation', 'Page.frameClearedScheduledNavigation', 'Page.frameNavigated', 'Page.navigatedWithinDocument', 'Page.lifecycleEvent',
      'Network.webSocketCreated', 'Network.webSocketWillSendHandshakeRequest', 'Network.webSocketHandshakeResponseReceived', 'Network.webSocketFrameSent',
      'Network.webSocketFrameReceived', 'Network.webSocketFrameError', 'Network.webSocketClosed', 'Network.loadingFailed', 'Runtime.exceptionThrown', 'Runtime.consoleAPICalled']) {
      cdp.on(type, event => emit(type, event));
    }
    cdp.on('Network.requestWillBeSent', ({ request, ...event }) => emit('Network.requestWillBeSent', {
      ...event, request: { url: request.url, method: request.method, referrerPolicy: request.referrerPolicy, isLinkPreload: request.isLinkPreload },
    }));
    await cdp.send('Page.enable');
    await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    return cdp;
  };
  const attachFrame = async (frame, context, label) => {
    if (pages.has(frame)) return pages.get(frame);
    const pageId = `${label}/iframe-${++pageIndex}`;
    const emit = (type, data) => write('browser.ndjson', { ...data, cdpType: data.type, pageId, type });
    const ready = captureProtocol(frame, context, emit).then(() => emit('iframe-attached', { url: frame.url() })).catch(error => {
      if (!error.message.includes('This frame does not have a separate CDP session')) throw error;
      return emit('iframe-uses-parent-cdp-session', { url: frame.url() });
    });
    pages.set(frame, ready);
    return ready;
  };
  const attach = (page, context, label) => {
    if (pages.has(page)) return pages.get(page);
    const pageId = `${label}/${++pageIndex}`;
    const emit = (type, data) => write('browser.ndjson', { ...data, cdpType: data.type, pageId, type });
    page.on('console', message => emit('console', { level: message.type(), text: message.text(), location: message.location() }));
    page.on('crash', () => emit('crash', {}));
    page.on('close', () => emit('page-close', {}));
    if (navigation) page.on('request', request => {
      const classification = navigation.observe(page, request);
      if (classification) void emit('document-navigation', { url: request.url(), ...classification });
    });
    const ready = captureProtocol(page, context, emit).then(() => emit('attached', { url: page.url() }));
    pages.set(page, ready);
    return ready;
  };
  return { write, server, attach, attachFrame, flush: () => tail };
}
