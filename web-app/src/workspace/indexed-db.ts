import type { DraftSessionIdentity, PersistedDraftSession } from '@/stores/draftSessionStorage';
import type { V1Import } from './v1-import';

export const DRAFT_DATABASE = 'fantasy-draft-workspace-v2';
export const IMPORT_METADATA = 'fantasy-draft-v1-import-v2';
const STORES = ['sessions', 'metadata', 'probes'] as const;
export interface StorageDiagnostic { readonly phase: 'open' | 'blocked' | 'upgrade' | 'error' | 'abort'; readonly error: unknown }
const asError = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));
const sessionKey = (identity: DraftSessionIdentity): string => `${identity.provider}:${identity.draftId}`;
type ImportRefusal = { readonly identity: DraftSessionIdentity; readonly reason: string };

export interface DraftDatabase {
  read(identity: DraftSessionIdentity): Promise<PersistedDraftSession | null>;
  update<T>(identity: DraftSessionIdentity, apply: (latest: PersistedDraftSession | null) => { session: PersistedDraftSession; result: T }): Promise<{ session: PersistedDraftSession; result: T }>;
  importV1(value: V1Import, options?: { verifySource?: () => void }): Promise<{ refused: readonly ImportRefusal[] }>;
  inspectImports(): Promise<readonly unknown[]>;
  probe(key: string, value?: string | null): Promise<string | null>;
  close(): void;
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function openDraftDatabase({ factory, decode, report, name = DRAFT_DATABASE }: {
  factory: IDBFactory;
  decode: (value: unknown) => PersistedDraftSession;
  report: (diagnostic: StorageDiagnostic) => void;
  name?: string;
}): Promise<DraftDatabase> {
  return new Promise((resolve, reject) => {
    let failed = false;
    let request: IDBOpenDBRequest;
    const fail = (phase: StorageDiagnostic['phase'], error: unknown): void => {
      failed = true; report({ phase, error }); reject(asError(error));
    };
    try { request = factory.open(name, 1); } catch (error) { fail('open', error); return; }
    request.onblocked = () => { fail('blocked', new Error('Close other draft windows before opening workspace storage')); };
    request.onerror = () => { fail('open', request.error); };
    request.onupgradeneeded = () => {
      try { for (const store of STORES) request.result.createObjectStore(store); }
      catch (error) { fail('upgrade', error); request.transaction?.abort(); }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (failed) { database.close(); return; }
      database.onversionchange = () => { database.close(); };
      function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, done: (value: T) => void, abort: (error: unknown) => void) => void): Promise<T> {
        return new Promise((complete, refuse) => {
          let tx: IDBTransaction;
          try { tx = database.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); } catch (error) { report({ phase: 'error', error }); refuse(asError(error)); return; }
          let result: { value: T } | undefined;
          let failure: unknown;
          const abort = (error: unknown): void => { failure ??= error; tx.abort(); };
          tx.onerror = () => { report({ phase: 'error', error: failure ?? tx.error }); };
          tx.onabort = () => { const error = failure ?? tx.error ?? new Error('Workspace transaction aborted'); report({ phase: 'abort', error }); refuse(asError(error)); };
          tx.oncomplete = () => {
            if (!result) { refuse(new Error('Workspace transaction completed without a result')); return; }
            complete(result.value);
          };
          try { run(tx, value => { result = { value }; }, abort); } catch (error) { abort(error); }
        });
      }
      function readSession(value: unknown): PersistedDraftSession | null {
        if (value === undefined) return null;
        return decode(value);
      }
      resolve({
        read: identity => transaction(['sessions'], 'readonly', (tx, done, abort) => {
          const get = tx.objectStore('sessions').get(sessionKey(identity));
          get.onsuccess = () => { try { done(readSession(get.result)); } catch (error) { abort(error); } };
        }),
        update: (identity, apply) => transaction(['sessions'], 'readwrite', (tx, done, abort) => {
          const store = tx.objectStore('sessions');
          const get = store.get(sessionKey(identity));
          get.onsuccess = () => {
            try {
              const previous = readSession(get.result);
              const next = apply(previous);
              const session = decode(next.session);
              if (session.identity.provider !== identity.provider || session.identity.draftId !== identity.draftId) throw new Error('Workspace transaction changed session identity');
              if (JSON.stringify(session) !== JSON.stringify(previous)) store.put(session, sessionKey(identity));
              done({ session, result: next.result });
            } catch (error) { abort(error); }
          };
        }),
        async importV1(value, { verifySource } = {}) {
          const source = [...value.source].sort((a, b) => a.key.localeCompare(b.key));
          const snapshotDigest = await digest({ ...value, source });
          const sources = await Promise.all(value.sessions.map(async session => {
            const key = sessionKey(session.identity);
            const raw = source.filter(entry => entry.key === `fantasy-draft-session-v1:${key}` || entry.key.startsWith(`fantasy-draft-session-unconfirmed-v1:${key}:`));
            return { session, key, sourceDigest: await digest({ raw, session }) };
          }));
          return transaction(['sessions', 'metadata'], 'readwrite', (tx, done, abort) => {
            verifySource?.();
            const metadata = tx.objectStore('metadata');
            const store = tx.objectStore('sessions');
            const refused: ImportRefusal[] = [];
            let pending = sources.length;
            const finish = (): void => { verifySource?.(); done({ refused }); };
            metadata.put(value, `${IMPORT_METADATA}:snapshot:${snapshotDigest}`);
            if (!pending) finish();
            for (const { session, key, sourceDigest } of sources) {
              const existing = store.get(key);
              existing.onsuccess = () => {
                const marker = metadata.get(`${IMPORT_METADATA}:${key}`);
                marker.onsuccess = () => {
                  try {
                    verifySource?.();
                    const previous = readSession(existing.result);
                    const imported: unknown = marker.result;
                    const markerPresent = typeof imported === 'object' && imported !== null;
                    const sameSource = markerPresent && 'sourceDigest' in imported && imported.sourceDigest === sourceDigest;
                    const unchangedSinceImport = markerPresent && 'importedRevision' in imported && imported.importedRevision === previous?.revision;
                    if (!sameSource && (previous === null || unchangedSinceImport)) {
                      const decoded = decode(session);
                      store.put(decoded, key);
                      const unresolved = value.unresolved.some(journal => journal.key.startsWith(`fantasy-draft-session-unconfirmed-v1:${key}:`));
                      metadata.put({ identity: session.identity, importedRevision: decoded.revision, sourceDigest, complete: !unresolved }, `${IMPORT_METADATA}:${key}`);
                    } else if (!sameSource) {
                      const refusal = { identity: session.identity, reason: 'The v1 source differs from the acknowledged IndexedDB session' };
                      refused.push(refusal);
                      metadata.put({ ...refusal, source, sourceDigest }, `${IMPORT_METADATA}:refused:${key}:${sourceDigest}`);
                    }
                    if (--pending === 0) finish();
                  } catch (error) { abort(error); }
                };
              };
            }
          });
        },
        inspectImports: () => transaction(['metadata'], 'readonly', (tx, done, abort) => {
          const get = tx.objectStore('metadata').getAll();
          get.onsuccess = () => { const records: unknown = get.result; if (!Array.isArray(records)) { abort(new Error('Invalid import metadata')); return; } done(records); };
        }),
        probe: (key, value) => transaction(['probes'], value === undefined ? 'readonly' : 'readwrite', (tx, done, abort) => {
          const store = tx.objectStore('probes');
          if (value === null) store.delete(key);
          else if (value !== undefined) store.put(value, key);
          const get = store.get(key);
          get.onsuccess = () => {
            const result: unknown = get.result;
            if (result !== undefined && typeof result !== 'string') { abort(new Error('Invalid storage probe')); return; }
            done(result ?? null);
          };
        }),
        close: () => { database.close(); },
      });
    };
  });
}
