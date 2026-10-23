// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDraftDatabase } from './indexed-db';
import { assertCanonicalOrigin, serveStorageProbe, verifyStorageSharing } from './storage-sharing';
import { startStorageSharing } from '../../../extension/src/sidepanel/storage-sharing';

const canonicalOrigin = 'http://localhost:3000';
const location = { origin: canonicalOrigin, pathname: '/draft', search: '' };
const nonce = '0123456789abcdef0123456789abcdef';
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

async function readProbe(factory: IDBFactory): Promise<string | null> {
  const database = await openDraftDatabase({ factory, decode: () => { throw new Error('Session access is forbidden'); }, report: vi.fn() });
  try { return await database.probe(`sharing:${nonce}`); }
  finally { database.close(); }
}

describe('workspace origin and IndexedDB sharing', () => {
  it('finishes a top/frame/top nonce round trip using only the probe store and removes the nonce', async () => {
    const factory = new IDBFactory();
    const reads = vi.spyOn(FakeObjectStore.prototype, 'get');
    await Promise.all([
      serveStorageProbe(nonce, { factory, canonicalOrigin, location }),
      verifyStorageSharing({ factory, canonicalOrigin, location, nonce }),
    ]);
    expect(reads).toHaveBeenCalled();
    for (const store of reads.mock.contexts) expect(store).toHaveProperty('name', 'probes');
    expect(await readProbe(factory)).toBeNull();
  });

  it('blocks a frame when the top helper uses a separate partition', async () => {
    const options = { canonicalOrigin, location, timeoutMs: 80 };
    const outcomes = await Promise.allSettled([
      serveStorageProbe(nonce, { ...options, factory: new IDBFactory() }),
      verifyStorageSharing({ ...options, factory: new IDBFactory(), nonce }),
    ]);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') expect(String(outcome.reason)).toContain('timed out');
    }
  });

  it('does not accept a helper nonce without top-level confirmation of the frame write', async () => {
    const factory = new IDBFactory();
    const database = await openDraftDatabase({ factory, decode: () => { throw new Error('No sessions'); }, report: vi.fn() });
    await database.probe(`sharing:${nonce}`, `top:${nonce}`);
    await expect(verifyStorageSharing({ factory, canonicalOrigin, location, nonce, timeoutMs: 80 })).rejects.toThrow('timed out');
    await vi.waitFor(async () => { expect(await database.probe(`sharing:${nonce}`)).toBeNull(); });
    database.close();
  });

  it('reports denied probe reads as a storage error instead of a successful check', async () => {
    const factory = new IDBFactory();
    vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(() => { throw new DOMException('Read denied', 'SecurityError'); });
    await expect(verifyStorageSharing({ factory, canonicalOrigin, location, nonce })).rejects.toThrow('Read denied');
    await expect(serveStorageProbe(nonce, { factory, canonicalOrigin, location })).rejects.toThrow('Read denied');
  });

  it('rejects a denied database open', async () => {
    const factory = new IDBFactory();
    vi.spyOn(factory, 'open').mockImplementation(() => { throw new DOMException('Storage denied', 'SecurityError'); });
    await expect(verifyStorageSharing({ factory, canonicalOrigin, location, nonce })).rejects.toThrow('Storage denied');
  });

  it.each(['http://127.0.0.1:3000', 'http://localhost:3002', 'https://localhost:3000'])('blocks %s before opening a database', async origin => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');
    await expect(verifyStorageSharing({ factory, canonicalOrigin, location: { ...location, origin }, nonce })).rejects.toThrow('Other origins');
    expect(open).not.toHaveBeenCalled();
  });

  it('uses the configured canonical port rather than the production default', () => {
    expect(() => { assertCanonicalOrigin('http://localhost:4300', { origin: 'http://localhost:4300' }); }).not.toThrow();
    expect(() => { assertCanonicalOrigin('http://127.0.0.1:4300', { origin: 'http://127.0.0.1:4300' }); }).toThrow();
  });

  it('checks only the origin on top-level app pages and never opens IDB', async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');
    await verifyStorageSharing({ factory, canonicalOrigin, location });
    expect(open).not.toHaveBeenCalled();
  });

  it('requires a nonce on the side panel and rejects invalid nonces before opening IDB', async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');
    await expect(verifyStorageSharing({ factory, canonicalOrigin, location: { ...location, pathname: '/sidepanel' } })).rejects.toThrow('not been checked');
    await expect(serveStorageProbe('', { factory, canonicalOrigin, location })).rejects.toThrow('fresh helper nonce');
    expect(open).not.toHaveBeenCalled();
  });
});

function panelSetup({ allowed = true, createError }: { allowed?: boolean; createError?: Error } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const create = vi.fn((_properties: { url: string; active: boolean }) => createError ? Promise.reject(createError) : Promise.resolve({ id: 123 }));
  const remove = vi.fn().mockResolvedValue(undefined);
  const contains = vi.fn().mockResolvedValue(allowed);
  vi.stubGlobal('chrome', { permissions: { contains }, tabs: { create, remove } });
  const ready = vi.fn();
  const failed = vi.fn();
  disposers.push(startStorageSharing({ frame, frameUrl: `${canonicalOrigin}/sidepanel?provider=sleeper`, ready, failed }));
  return { frame, create, remove, contains, ready, failed };
}

function sharingMessage(frame: HTMLIFrameElement, overrides: Record<string, unknown> = {}, origin = canonicalOrigin): void {
  const frameNonce = new URL(frame.src).searchParams.get('__storageNonce');
  window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow,
    origin,
    data: { type: 'FANTASY_DRAFT_STORAGE_SHARING', nonce: frameNonce, ok: true, ...overrides },
  }));
}

describe('extension writer-free helper startup', () => {
  it('supports no existing app tab and closes only its helper after a verified result', async () => {
    const { frame, create, remove, contains, ready, failed } = panelSetup();
    await vi.waitFor(() => { expect(frame.src).toContain('__storageNonce='); });
    const helper = new URL(create.mock.calls[0]?.[0].url ?? '');
    expect(helper.origin).toBe(canonicalOrigin);
    expect(helper.searchParams.get('__storageProbe')).toBe(new URL(frame.src).searchParams.get('__storageNonce'));
    expect(contains).toHaveBeenCalledWith({ origins: [`${canonicalOrigin}/*`] });
    sharingMessage(frame, {}, 'http://127.0.0.1:3000');
    sharingMessage(frame, { nonce: 'wrong' });
    expect(ready).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    sharingMessage(frame);
    expect(ready).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledExactlyOnceWith(123);
  });

  it('blocks before loading a frame or opening a helper when host permission is denied', async () => {
    const { frame, create, ready, failed } = panelSetup({ allowed: false });
    await vi.waitFor(() => { expect(failed).toHaveBeenCalledOnce(); });
    expect(frame.hasAttribute('src')).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it('reports blocked helper creation and supports retry with a fresh helper', async () => {
    const blocked = panelSetup({ createError: new Error('Tab creation blocked') });
    await vi.waitFor(() => { expect(blocked.failed).toHaveBeenCalledOnce(); });
    expect(blocked.frame.hasAttribute('src')).toBe(false);
    const retried = panelSetup();
    await vi.waitFor(() => { expect(retried.frame.src).toContain('__storageNonce='); });
    sharingMessage(retried.frame);
    expect(retried.ready).toHaveBeenCalledOnce();
  });

  it('removes the frame and helper on a failed sharing result', async () => {
    const { frame, remove, ready, failed } = panelSetup();
    await vi.waitFor(() => { expect(frame.src).toContain('__storageNonce='); });
    sharingMessage(frame, { ok: false, error: 'Read denied' });
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'Read denied' }));
    expect(ready).not.toHaveBeenCalled();
    expect(frame.hasAttribute('src')).toBe(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith(123);
  });

  it('times out and closes its helper without reporting success on frame load', async () => {
    vi.useFakeTimers();
    const { frame, remove, ready, failed } = panelSetup();
    await vi.advanceTimersByTimeAsync(0);
    frame.dispatchEvent(new Event('load'));
    expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(failed).toHaveBeenCalledOnce();
    expect(frame.hasAttribute('src')).toBe(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith(123);
  });

  it('closes a helper that finishes opening after cancellation without loading the frame', async () => {
    let finish: ((tab: { id: number }) => void) | undefined;
    const create = vi.fn(() => new Promise<{ id: number }>(resolve => { finish = resolve; }));
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(true) }, tabs: { create, remove } });
    const frame = document.createElement('iframe');
    const ready = vi.fn(); const failed = vi.fn();
    const stop = startStorageSharing({ frame, frameUrl: `${canonicalOrigin}/sidepanel`, ready, failed });
    await vi.waitFor(() => { expect(create).toHaveBeenCalledOnce(); });
    stop(); finish?.({ id: 456 });
    await vi.waitFor(() => { expect(remove).toHaveBeenCalledExactlyOnceWith(456); });
    expect(frame.hasAttribute('src')).toBe(false);
    expect(ready).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
});

async function bootstrapSidePanel({ harness = true, allowed = true, blockedFirst = false } = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_PERSISTENCE_HARNESS', harness ? 'idb' : '');
  document.body.innerHTML = `
    <iframe id="sidepanel-frame"></iframe>
    <div id="loading-state"></div><div id="error-state"></div><div id="pairing-state"></div>
    <button id="retry-frame"></button><button id="open-webapp"></button>
  `;
  const create = vi.fn().mockResolvedValue({ id: 789 });
  if (blockedFirst) create.mockRejectedValueOnce(new Error('Tab creation blocked'));
  const remove = vi.fn().mockResolvedValue(undefined);
  const contains = vi.fn().mockResolvedValue(allowed);
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn() } },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ success: true, data: { status: { isInDraftRoom: false } } }),
      onMessage: { addListener: vi.fn() },
    },
    permissions: { contains }, tabs: { create, remove },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await import('../../../extension/src/sidepanel/sidepanel');
  const frame = document.querySelector('iframe');
  const loading = document.getElementById('loading-state');
  const error = document.getElementById('error-state');
  if (!frame || !loading || !error) throw new Error('Side panel fixture is missing');
  disposers.push(() => { window.dispatchEvent(new Event('pagehide')); frame.dispatchEvent(new Event('load')); });
  return { frame, loading, error, contains, create, remove };
}

describe('side panel bootstrap activation gate', () => {
  it('shows the existing error state on missing host permission, including after a frame load event', async () => {
    const { frame, error, loading, create } = await bootstrapSidePanel({ allowed: false });
    await vi.waitFor(() => { expect(error.hidden).toBe(false); expect(loading.hidden).toBe(true); });
    expect(frame.hasAttribute('src')).toBe(false);
    expect(create).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event('load'));
    expect(error.hidden).toBe(false);
  });

  it('retries a blocked helper through Open web app and remains loading until sharing succeeds', async () => {
    const { frame, error, loading, remove } = await bootstrapSidePanel({ blockedFirst: true });
    await vi.waitFor(() => { expect(error.hidden).toBe(false); expect(loading.hidden).toBe(true); });
    document.getElementById('open-webapp')?.click();
    await vi.waitFor(() => { expect(frame.src).toContain('__storageNonce='); });
    frame.dispatchEvent(new Event('load'));
    expect(loading.hidden).toBe(false);
    sharingMessage(frame);
    expect(loading.hidden).toBe(true);
    expect(error.hidden).toBe(true);
    expect(remove).toHaveBeenCalledExactlyOnceWith(789);
  });

  it('keeps normal startup on the existing URL path without permissions, helpers, or IndexedDB', async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');
    vi.stubGlobal('indexedDB', factory);
    const { frame, contains, create } = await bootstrapSidePanel({ harness: false });
    await vi.waitFor(() => { expect(frame.src).toBe(`${canonicalOrigin}/sidepanel?provider=espn`); });
    expect(contains).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
