import { openDraftDatabase, type DraftDatabase } from './indexed-db';

const SHARING_CHANNEL = 'fantasy-draft-storage-sharing-v1';
const RESULT_TYPE = 'FANTASY_DRAFT_STORAGE_SHARING';
const verifiedSharing = Symbol('verified storage sharing');
export type VerifiedStorageSharing = { readonly [verifiedSharing]: true; readonly origin: string; readonly kind: 'origin-only' | 'probed' };
const DEFAULT_TIMEOUT = 8_000;
const POLL_INTERVAL = 25;
type ProbeLocation = Pick<Location, 'origin' | 'search' | 'pathname'>;
interface ProbeOptions {
  readonly canonicalOrigin?: string;
  readonly location?: ProbeLocation;
  readonly factory?: IDBFactory;
  readonly timeoutMs?: number;
}

export class StorageSharingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageSharingError';
  }
}

export function assertCanonicalOrigin(canonicalOrigin: string, location: Pick<Location, 'origin'>): void {
  const canonical = new URL(canonicalOrigin);
  if (canonical.protocol !== 'http:' || canonical.hostname !== 'localhost' ||
      canonical.origin !== canonicalOrigin || location.origin !== canonicalOrigin) {
    throw new StorageSharingError(`Open the draft app at ${canonicalOrigin} before using workspace storage. Other origins have separate draft records.`);
  }
}

function validateNonce(nonce: string): void {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) throw new StorageSharingError('The storage sharing check needs a fresh helper nonce. Open the web app to retry.');
}

async function runProbe(nonce: string, options: ProbeOptions, role: 'top' | 'frame'): Promise<void> {
  validateNonce(nonce);
  const key = `sharing:${nonce}`;
  let database: DraftDatabase | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const checkRunning = (): void => {
    if (stopped) throw new StorageSharingError('Storage sharing check timed out. Check host permission and open the web app to retry.');
  };
  const work = async (): Promise<void> => {
    const opened = await openDraftDatabase({
      factory: options.factory ?? indexedDB,
      decode: () => { throw new Error('A storage sharing helper cannot access draft sessions'); },
      report: () => undefined,
    });
    if (stopped) { opened.close(); checkRunning(); }
    database = opened;
    const write = async (value: string | null): Promise<void> => {
      checkRunning();
      await opened.probe(key, value);
      checkRunning();
    };
    const waitFor = async (value: string | null): Promise<void> => {
      for (;;) {
        checkRunning();
        const actual = await opened.probe(key);
        checkRunning();
        if (actual === value) return;
        await new Promise<void>(resolve => { setTimeout(resolve, POLL_INTERVAL); });
      }
    };
    if (role === 'top') {
      await write(`top:${nonce}`);
      await waitFor(`frame:${nonce}`);
      await write(`confirmed:${nonce}`);
      await waitFor(`acknowledged:${nonce}`);
      await write(null);
    } else {
      await waitFor(`top:${nonce}`);
      await write(`frame:${nonce}`);
      await waitFor(`confirmed:${nonce}`);
      await write(`acknowledged:${nonce}`);
      await waitFor(null);
    }
  };
  try {
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stopped = true;
          reject(new StorageSharingError('Storage sharing check timed out. Check host permission and open the web app to retry.'));
        }, options.timeoutMs ?? DEFAULT_TIMEOUT);
      }),
    ]);
  } catch (error) {
    if (error instanceof StorageSharingError) throw error;
    throw new StorageSharingError(`Workspace storage is unavailable. Check host permission and open the web app to retry. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stopped = true;
    clearTimeout(timer);
    if (database) {
      // Queue cleanup before closing; closing waits for existing transactions.
      void database.probe(key, null).catch(() => undefined);
      database.close();
    }
  }
}

export async function verifyStorageSharing(options: ProbeOptions & { readonly canonicalOrigin: string; readonly nonce?: string }): Promise<VerifiedStorageSharing> {
  const location = options.location ?? window.location;
  const nonce = options.nonce ?? new URLSearchParams(location.search).get('__storageNonce');
  const embedded = window.parent !== window;
  const parentOrigin = new URLSearchParams(location.search).get('__storageParentOrigin');
  const reply = (value: unknown): void => {
    if (embedded && parentOrigin && /^chrome-extension:\/\/[a-p]{32}$/.test(parentOrigin)) window.parent.postMessage(value, parentOrigin);
  };
  try {
    assertCanonicalOrigin(options.canonicalOrigin, location);
    if (nonce === null || nonce === undefined) {
      if (embedded || location.pathname === '/sidepanel') throw new StorageSharingError('Storage sharing has not been checked. Open the web app to retry.');
      return { [verifiedSharing]: true, origin: location.origin, kind: 'origin-only' };
    }
    if (!(import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb')) await requestAppTab(nonce, options.timeoutMs ?? DEFAULT_TIMEOUT);
    await runProbe(nonce, options, 'frame');
    reply({ type: RESULT_TYPE, nonce, ok: true });
    return { [verifiedSharing]: true, origin: location.origin, kind: 'probed' };
  } catch (error) {
    reply({ type: RESULT_TYPE, nonce, ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function serveStorageProbe(nonce: string, options: ProbeOptions = {}): Promise<void> {
  if (!(import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb')) throw new StorageSharingError('The storage helper is available only in the development harness.');
  const location = options.location ?? window.location;
  assertCanonicalOrigin(options.canonicalOrigin ?? location.origin, location);
  if (window.parent !== window) throw new StorageSharingError('The storage helper must open in a top-level tab.');
  await runProbe(nonce, options, 'top');
}


function requestAppTab(nonce: string, timeoutMs: number): Promise<void> {
  validateNonce(nonce);
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(SHARING_CHANNEL);
    const timer = setTimeout(() => {
      channel.close();
      reject(new StorageSharingError('Keep the draft web app open in a normal tab, then retry the side panel storage check.'));
    }, timeoutMs);
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'offer' ||
          !('nonce' in value) || value.nonce !== nonce || !('responder' in value) || typeof value.responder !== 'string') return;
      channel.postMessage({ type: 'begin', nonce, responder: value.responder });
      clearTimeout(timer); channel.close(); resolve();
    });
    channel.postMessage({ type: 'request', nonce });
  });
}

/** Ordinary top-level app tabs verify that the installed panel shares their storage partition. */
export function installStorageSharingResponder(options: ProbeOptions & { readonly canonicalOrigin: string }): () => void {
  const location = options.location ?? window.location;
  assertCanonicalOrigin(options.canonicalOrigin, location);
  if (window.parent !== window || location.pathname === '/sidepanel') return () => undefined;
  const channel = new BroadcastChannel(SHARING_CHANNEL);
  const responder = crypto.randomUUID();
  const active = new Set<string>();
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const value = event.data;
    if (typeof value !== 'object' || value === null || !('type' in value) || !('nonce' in value) ||
        typeof value.nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(value.nonce)) return;
    const nonce = value.nonce;
    if (value.type === 'request') channel.postMessage({ type: 'offer', nonce, responder });
    else if (value.type === 'begin' && 'responder' in value && value.responder === responder && !active.has(nonce)) {
      active.add(nonce);
      void runProbe(nonce, options, 'top').catch(() => undefined).finally(() => { active.delete(nonce); });
    }
  });
  return () => { channel.close(); };
}
