/// <reference types="chrome" />
import { LOCAL_PORTS } from '../shared/local-config';

const RESULT_TYPE = 'FANTASY_DRAFT_STORAGE_SHARING';
const TIMEOUT = 10_000;

/** Opens only a writer-free helper. The caller must keep commands blocked until ready. */
export function startStorageSharing({ frame, frameUrl, ready, failed }: {
  readonly frame: HTMLIFrameElement;
  readonly frameUrl: string;
  readonly ready: () => void;
  readonly failed: (error: Error) => void;
}): () => void {
  let helperId: number | undefined;
  let stopped = false;
  const canonicalOrigin = LOCAL_PORTS.webOrigin;
  const nonce = crypto.randomUUID();
  const helper = new URL(canonicalOrigin);
  helper.searchParams.set('__storageProbe', nonce);
  const panel = new URL(frameUrl);
  const closeHelper = (): void => {
    if (helperId !== undefined) {
      const id = helperId;
      helperId = undefined;
      void chrome.tabs.remove(id).catch(() => undefined);
    }
  };
  const stop = (): void => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener('message', receive);
    closeHelper();
  };
  const fail = (error: Error): void => {
    if (stopped) return;
    stop();
    frame.removeAttribute('src');
    failed(error);
  };
  function receive(event: MessageEvent<unknown>): void {
    if (stopped || event.origin !== canonicalOrigin || event.source !== frame.contentWindow) return;
    const value = event.data;
    if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== RESULT_TYPE ||
        !('nonce' in value) || value.nonce !== nonce || !('ok' in value) || typeof value.ok !== 'boolean') return;
    if (value.ok) { stop(); ready(); }
    else fail(new Error('error' in value && typeof value.error === 'string' ? value.error : 'Workspace storage is not shared with the web app.'));
  }
  const timer = setTimeout(() => { fail(new Error('Storage sharing check timed out. Open the web app to retry.')); }, TIMEOUT);
  void (async () => {
    try {
      if (panel.origin !== canonicalOrigin) throw new Error(`Open the draft app at ${canonicalOrigin}. Other origins have separate draft records.`);
      const allowed = await chrome.permissions.contains({ origins: [`${canonicalOrigin}/*`] });
      if (stopped) return;
      if (!allowed) throw new Error('Allow host permission for the web app before opening workspace storage.');
      window.addEventListener('message', receive);
      const created = await chrome.tabs.create({ url: helper.toString(), active: false });
      helperId = created.id;
      if (stopped) { closeHelper(); return; }
      if (helperId === undefined) throw new Error('Unable to open the storage helper. Open the web app to retry.');
      panel.searchParams.set('__storageNonce', nonce);
      panel.searchParams.set('__storageParentOrigin', window.location.origin);
      frame.src = panel.toString();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return stop;
}
