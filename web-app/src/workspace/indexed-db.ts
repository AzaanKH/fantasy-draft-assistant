import type { DraftSessionIdentity, PersistedDraftSession } from '@/stores/draftSessionStorage';
import type { V1Import } from './v1-import';

export const DRAFT_DATABASE = 'fantasy-draft-workspace-v2';
export const IMPORT_METADATA = 'fantasy-draft-v1-import-v2';
const STORES = ['sessions', 'metadata', 'probes'] as const;
export interface StorageDiagnostic { readonly phase: 'open' | 'blocked' | 'upgrade' | 'error' | 'abort'; readonly error: unknown }
const asError = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));
const sessionKey = (identity: DraftSessionIdentity): string => `${identity.provider}:${identity.draftId}`;

export interface DraftDatabase {
  read(identity: DraftSessionIdentity): Promise<PersistedDraftSession | null>;
  update<T>(identity: DraftSessionIdentity, apply: (latest: PersistedDraftSession | null) => { session: PersistedDraftSession; result: T }): Promise<{ session: PersistedDraftSession; result: T }>;
  importV1(value: V1Import): Promise<void>;
  inspectImports(): Promise<readonly unknown[]>;
  probe(key: string, value?: string | null): Promise<string | null>;
  close(): void;
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
      function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
        return new Promise((complete, refuse) => {
          let tx: IDBTransaction;
          try { tx = database.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); } catch (error) { report({ phase: 'error', error }); refuse(asError(error)); return; }
          let result: { value: T } | undefined;
          let failure: unknown;
          tx.onerror = () => { report({ phase: 'error', error: tx.error }); };
          tx.onabort = () => { const error = failure ?? tx.error ?? new Error('Workspace transaction aborted'); report({ phase: 'abort', error }); refuse(asError(error)); };
          tx.oncomplete = () => {
            if (!result) { refuse(new Error('Workspace transaction completed without a result')); return; }
            complete(result.value);
          };
          try { run(tx, value => { result = { value }; }); } catch (error) { failure = error; tx.abort(); }
        });
      }
      function readSession(value: unknown): PersistedDraftSession | null {
        if (value === undefined) return null;
        return decode(value);
      }
      resolve({
        read: identity => transaction(['sessions'], 'readonly', (tx, done) => {
          const get = tx.objectStore('sessions').get(sessionKey(identity));
          get.onsuccess = () => { try { done(readSession(get.result)); } catch (error) { report({ phase: 'error', error }); tx.abort(); } };
        }),
        update: (identity, apply) => transaction(['sessions'], 'readwrite', (tx, done) => {
          const store = tx.objectStore('sessions');
          const get = store.get(sessionKey(identity));
          get.onsuccess = () => {
            try {
              const next = apply(readSession(get.result));
              if (next.session.identity.provider !== identity.provider || next.session.identity.draftId !== identity.draftId) throw new Error('Workspace transaction changed session identity');
              store.put(next.session, sessionKey(identity)); done(next);
            } catch (error) { report({ phase: 'error', error }); tx.abort(); }
          };
        }),
        importV1: value => transaction(['sessions', 'metadata'], 'readwrite', (tx, done) => {
          const metadata = tx.objectStore('metadata');
          for (const session of value.sessions) {
            const store = tx.objectStore('sessions');
            const key = sessionKey(session.identity);
            const existing = store.get(key);
            existing.onsuccess = () => {
              const marker = metadata.get(`${IMPORT_METADATA}:${key}`);
              marker.onsuccess = () => {
                try {
                  const previous = readSession(existing.result);
                  const imported: unknown = marker.result;
                  const unchangedSinceImport = typeof imported === 'object' && imported !== null &&
                    'importedRevision' in imported && imported.importedRevision === previous?.revision;
                  const applied = previous === null || unchangedSinceImport;
                  if (applied) {
                    store.put(session, key);
                    const pending = value.unresolved.some(journal => journal.key.startsWith(`fantasy-draft-session-unconfirmed-v1:${key}:`));
                    metadata.put({ source: value.source, identity: session.identity, importedRevision: session.revision, complete: !pending }, `${IMPORT_METADATA}:${key}`);
                  }
                } catch (error) { report({ phase: 'error', error }); tx.abort(); }
              };
            };
          }
          metadata.put(value, `${IMPORT_METADATA}:snapshot:${crypto.randomUUID()}`);
          done(undefined);
        }),
        inspectImports: () => transaction(['metadata'], 'readonly', (tx, done) => {
          const get = tx.objectStore('metadata').getAll();
          get.onsuccess = () => { const records: unknown = get.result; if (!Array.isArray(records)) { tx.abort(); return; } done(records); };
        }),
        probe: (key, value) => transaction(['probes'], value === undefined ? 'readonly' : 'readwrite', (tx, done) => {
          const store = tx.objectStore('probes');
          if (value === null) store.delete(key);
          else if (value !== undefined) store.put(value, key);
          const get = store.get(key);
          get.onsuccess = () => {
            const result: unknown = get.result;
            if (result !== undefined && typeof result !== 'string') { tx.abort(); return; }
            done(result ?? null);
          };
        }),
        close: () => { database.close(); },
      });
    };
  });
}
