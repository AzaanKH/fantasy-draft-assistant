/// <reference types="chrome" />
import { LOCAL_PORTS } from '../shared/local-config';

const RESULT_TYPE = 'FANTASY_DRAFT_STORAGE_SHARING';

/** Which step of the storage check failed; each has its own corrective instruction in the panel. */
export type StorageSharingFailureKind = 'origin' | 'permission' | 'refused' | 'timeout' | 'helper';

export class StorageSharingFailure extends Error {
  constructor(readonly kind: StorageSharingFailureKind, message: string) {
    super(message);
    this.name = 'StorageSharingFailure';
  }
}

/** Panel copy for a failed check: what is wrong, the one action that fixes it, and an optional developer hint. */
export interface StorageSharingFailureCopy {
  readonly kind: StorageSharingFailureKind;
  readonly title: string;
  readonly detail: string;
  /** Secondary, smaller text for people running the app from source. */
  readonly hint?: string;
}

/** Shown under failures that mean the local web app is not running. */
export const DEVELOPER_START_HINT = 'Running from source? Start it with pnpm dev:live.';

export function describeStorageSharingFailure(error: Error, canonicalOrigin: string): StorageSharingFailureCopy {
  const kind = error instanceof StorageSharingFailure ? error.kind : 'helper';
  switch (kind) {
    case 'permission':
      return { kind, title: 'Allow site access for the web app', detail: `Chrome has not let this extension open ${canonicalOrigin}. Open the extension's details in chrome://extensions, allow site access for ${canonicalOrigin}, then retry.` };
    case 'origin':
      return { kind, title: `Use the web app at ${canonicalOrigin}`, detail: `${error.message} Switch to ${canonicalOrigin} below, or change the web app address in the extension options, then retry.` };
    case 'refused':
      return { kind, title: 'Draft storage is not shared yet', detail: `${error.message} Open the full draft room in a normal tab so it can share storage with the panel, then retry.` };
    case 'timeout':
      return { kind, title: 'The web app did not answer', detail: `Nothing replied from ${canonicalOrigin} within 10 seconds. Make sure the Fantasy Draft web app is running on this computer, then retry.`, hint: DEVELOPER_START_HINT };
    case 'helper':
      return { kind, title: 'Web app unavailable', detail: `${error.message} Make sure the Fantasy Draft web app is running on this computer, then retry.`, hint: DEVELOPER_START_HINT };
  }
}
const TIMEOUT = 10_000;

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
  if (import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') helper.searchParams.set('__storageProbe', nonce);
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
    else fail(new StorageSharingFailure('refused', 'error' in value && typeof value.error === 'string' ? value.error : 'Workspace storage is not shared with the web app.'));
  }
  const timer = setTimeout(() => { fail(new StorageSharingFailure('timeout', 'Storage sharing check timed out. Open the web app to retry.')); }, TIMEOUT);
  void (async () => {
    try {
      if (panel.origin !== canonicalOrigin) throw new StorageSharingFailure('origin', `The side panel points at ${panel.origin}, which keeps separate draft records.`);
      const allowed = await chrome.permissions.contains({ origins: [`${canonicalOrigin}/*`] });
      if (stopped) return;
      if (!allowed) throw new StorageSharingFailure('permission', 'Allow host permission for the web app before opening workspace storage.');
      window.addEventListener('message', receive);
      if (import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') {
        const created = await chrome.tabs.create({ url: helper.toString(), active: false });
        helperId = created.id;
        if (stopped) { closeHelper(); return; }
        if (helperId === undefined) throw new StorageSharingFailure('helper', 'Unable to open the storage helper.');
      }
      panel.searchParams.set('__storageNonce', nonce);
      panel.searchParams.set('__storageParentOrigin', window.location.origin);
      frame.src = panel.toString();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return stop;
}
