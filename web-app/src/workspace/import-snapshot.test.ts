// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as indexedDatabase from './indexed-db';
import type { StorageDiagnostic } from './indexed-db';
import type { DraftSessionIdentity } from '@/stores/draftSessionStorage';
import { decodeIndexedSession } from './idb-session';
import { initialDraftState, sessionFromState } from './draft-reducer';
import { createHarnessWorkspace, getHarnessBinding } from './harness-workspace';
import { captureV1ImportSnapshot, importV1Snapshot, V1ImportDiagnostic, V1SourceChangedError } from './import-snapshot';
import type { RawV1Entry, V1Import } from './v1-import';

const openDatabase = indexedDatabase.openDraftDatabase;
const identity = { provider: 'sleeper', draftId: '123' } as const;
const otherIdentity = { ...identity, draftId: '123-other' };
const sessionKey = `fantasy-draft-session-v1:${identity.provider}:${identity.draftId}`;
const originalSession = sessionFromState(initialDraftState(identity), identity, 1);
const rawSession = { key: sessionKey, serialized: JSON.stringify(originalSession) };

class SourceStorage {
  readonly entries: Map<string, string>;
  constructor(entries: readonly RawV1Entry[] = [rawSession]) { this.entries = new Map(entries.map(entry => [entry.key, entry.serialized])); }
  get length(): number { return this.entries.size; }
  key(index: number): string | null { return [...this.entries.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.entries.get(key) ?? null; }
}

function orphan(draftId: string, tab = 'tab'): RawV1Entry {
  return { key: `fantasy-draft-session-unconfirmed-v1:sleeper:${draftId}:${tab}`, serialized: JSON.stringify({
    version: 1, writeId: tab, baseWriteId: 'missing', revision: 2, picks: [], fields: {}, queueAdded: ['retained'], queueRemoved: [],
  }) };
}

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

async function database() {
  const value = await openDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: vi.fn() });
  cleanup.push(() => { value.close(); });
  return value;
}

function run(database: Parameters<typeof importV1Snapshot>[0]['database'], storage = new SourceStorage(), requestedIdentity: DraftSessionIdentity = identity) {
  const snapshot = captureV1ImportSnapshot(storage);
  const diagnostics: StorageDiagnostic[] = [];
  const report = vi.fn((diagnostic: StorageDiagnostic) => { diagnostics.push(diagnostic); });
  return { snapshot, report, diagnostics, start: () => importV1Snapshot({ database, snapshot, identity: requestedIdentity, report }) };
}

function reportedImport(diagnostics: readonly StorageDiagnostic[]): V1ImportDiagnostic {
  const error = diagnostics.find(diagnostic => diagnostic.error instanceof V1ImportDiagnostic)?.error;
  if (!(error instanceof V1ImportDiagnostic)) throw new Error('Expected an import diagnostic');
  return error;
}

function instrumentedImport(effect: (options?: { verifySource?: () => void }) => void = options => { options?.verifySource?.(); }) {
  return { importV1: vi.fn(async (_value: V1Import, options?: { verifySource?: () => void }) => {
    effect(options);
    return { refused: [] };
  }) };
}

describe('v1 import source snapshot', () => {
  it('captures the plan once and compares exact bytes and keys rather than storage enumeration order', () => {
    const storage = new SourceStorage([rawSession, orphan('other')]);
    const snapshot = captureV1ImportSnapshot(storage);
    storage.entries.delete(sessionKey); storage.entries.set(sessionKey, rawSession.serialized);
    expect(() => { snapshot.verifySource(); }).not.toThrow();
    expect(snapshot.imported.source).toEqual([rawSession, orphan('other')]);
    storage.entries.set(sessionKey, `${rawSession.serialized} `);
    expect(() => { snapshot.verifySource(); }).toThrow(V1SourceChangedError);
    expect(snapshot.imported.sessions[0]?.shortlistedPlayerIds).toEqual([]);
  });

  it.each(['add', 'remove', 'replace'] as const)('rejects a source key %s with the raw snapshots attached', action => {
    const storage = new SourceStorage();
    const snapshot = captureV1ImportSnapshot(storage);
    if (action !== 'add') storage.entries.delete(sessionKey);
    if (action !== 'remove') storage.entries.set(`${sessionKey}-other`, rawSession.serialized);
    expect(() => { snapshot.verifySource(); }).toThrow(V1SourceChangedError);
    try { snapshot.verifySource(); } catch (error) {
      expect(error).toMatchObject({ captured: [rawSession], current: [...storage.entries].map(([key, serialized]) => ({ key, serialized })) });
    }
  });

  it('propagates snapshot storage exceptions instead of importing empty data', () => {
    const failure = new Error('Storage access denied');
    const storage = new SourceStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw failure; });
    expect(() => captureV1ImportSnapshot(storage)).toThrow(failure);
  });

  it('passes the verifier into the transaction and checks again after completion', async () => {
    const storage = new SourceStorage();
    const importer = instrumentedImport(options => {
      options?.verifySource?.();
      storage.entries.set(sessionKey, `${rawSession.serialized} `);
    });
    const coordinator = run(importer, storage);
    await expect(coordinator.start()).rejects.toThrow(V1SourceChangedError);
    expect(importer.importV1.mock.calls[0]?.[0]).toBe(coordinator.snapshot.imported);
    expect(importer.importV1.mock.calls[0]?.[1]?.verifySource).toBe(coordinator.snapshot.verifySource);
  });

  it('does not turn import failures into successful binds', async () => {
    const failure = new Error('Import transaction failed');
    const importer = instrumentedImport(() => { throw failure; });
    await expect(run(importer).start()).rejects.toThrow(failure);
  });

  it('aborts the real import if the source changed while the database opened', async () => {
    const storage = new SourceStorage();
    const snapshot = captureV1ImportSnapshot(storage);
    const db = await database();
    storage.entries.set(sessionKey, JSON.stringify({ ...originalSession, shortlistedPlayerIds: ['late'] }));
    await expect(importV1Snapshot({ database: db, snapshot, identity, report: vi.fn() })).rejects.toThrow(V1SourceChangedError);
    expect(await db.read(identity)).toBeNull();
    expect(await db.inspectImports()).toEqual([]);
  });

  it('aborts the real transaction when a source changes after a session put', async () => {
    const storage = new SourceStorage();
    const db = await database();
    const descriptor = Object.getOwnPropertyDescriptor(FakeObjectStore.prototype, 'put');
    const originalPut: unknown = descriptor?.value;
    if (!descriptor || typeof originalPut !== 'function') throw new Error('Expected the fake object store put method');
    const restorePut = (): void => { Object.defineProperty(FakeObjectStore.prototype, 'put', descriptor); };
    cleanup.push(restorePut);
    Object.defineProperty(FakeObjectStore.prototype, 'put', { ...descriptor, value(this: IDBObjectStore, value: unknown, key?: IDBValidKey): unknown {
      const request: unknown = Reflect.apply(originalPut, this, [value, key]);
      if (this.name === 'sessions') storage.entries.set(sessionKey, `${rawSession.serialized} `);
      return request;
    } });
    await expect(run(db, storage).start()).rejects.toThrow(V1SourceChangedError);
    restorePut();
    expect(await db.read(identity)).toBeNull();
    expect(await db.inspectImports()).toEqual([]);
  });

  it('propagates a storage exception during the transactional source check', async () => {
    const storage = new SourceStorage();
    const db = await database();
    const coordinator = run(db, storage);
    const failure = new Error('Storage became unavailable');
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw failure; });
    await expect(coordinator.start()).rejects.toThrow(failure);
    expect(await db.read(identity)).toBeNull();
  });
});

describe('identity-scoped import diagnostics', () => {
  it('retains and reports every unresolved orphan without blocking an unrelated identity', async () => {
    const journals = [orphan(otherIdentity.draftId, 'first'), orphan('third', 'second')];
    const db = await database();
    const coordinator = run(db, new SourceStorage([rawSession, ...journals]));
    await coordinator.start();
    expect(reportedImport(coordinator.diagnostics).imported.unresolved.map(({ key, serialized }) => ({ key, serialized }))).toEqual(journals);
    expect(await db.inspectImports()).toContainEqual(coordinator.snapshot.imported);
    expect((await db.read(identity))?.identity).toEqual(identity);
  });

  it('blocks the requested identity with all unresolved raw bytes attached', async () => {
    const journals = [orphan(identity.draftId, 'first'), orphan(identity.draftId, 'second'), orphan(otherIdentity.draftId)];
    const coordinator = run(await database(), new SourceStorage(journals));
    await expect(coordinator.start()).rejects.toThrow(V1ImportDiagnostic);
    expect(reportedImport(coordinator.diagnostics).imported.unresolved.map(({ key, serialized }) => ({ key, serialized }))).toEqual(journals);
  });

  it.each(['imported', 'idb-first'])('surfaces a %s source refusal, retains its diagnostic, and blocks only its identity', async initial => {
    const db = await database();
    const storage = new SourceStorage();
    if (initial === 'imported') await run(db, storage).start();
    await db.update(identity, latest => {
      const previous = latest ?? originalSession;
      return { session: { ...previous, revision: previous.revision + 1, shortlistedPlayerIds: ['idb'] }, result: undefined };
    });
    storage.entries.set(sessionKey, JSON.stringify({ ...originalSession, revision: 3, shortlistedPlayerIds: ['v1'] }));
    const coordinator = run(db, storage);
    await expect(coordinator.start()).rejects.toThrow(V1ImportDiagnostic);
    const diagnostic = reportedImport(coordinator.diagnostics);
    expect(diagnostic.refused.map(row => row.identity)).toEqual([identity]);
    expect(diagnostic.refused[0]?.reason).toBeTruthy();
    expect(diagnostic.message).toContain(diagnostic.refused[0]?.reason);
    expect(diagnostic.imported.source).toEqual([{ key: sessionKey, serialized: storage.getItem(sessionKey) }]);
    const metadata = await db.inspectImports();
    for (const refusal of diagnostic.refused) expect(metadata).toContainEqual(expect.objectContaining({ ...refusal, source: diagnostic.imported.source }));
    expect((await db.read(identity))?.shortlistedPlayerIds).toEqual(['idb']);
    const unrelated = run(db, storage, otherIdentity);
    await unrelated.start();
    expect(reportedImport(unrelated.diagnostics).refused).toEqual(diagnostic.refused);
  });
});

async function harness(storage = new SourceStorage()) {
  vi.stubEnv('VITE_PERSISTENCE_HARNESS', 'idb');
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('indexedDB', new IDBFactory());
  const db = await database();
  const close = vi.spyOn(db, 'close');
  const open = vi.spyOn(indexedDatabase, 'openDraftDatabase').mockResolvedValue(db);
  const owner = createHarnessWorkspace();
  cleanup.push(() => { owner.dispose(); });
  return { db, close, open, owner, binding: getHarnessBinding() };
}

describe('harness import binding', () => {
  it('captures before opening and closes the database after a changed-source bind fails', async () => {
    const storage = new SourceStorage();
    const { db, open, close, binding, owner } = await harness(storage);
    open.mockImplementation(async () => {
      storage.entries.set(sessionKey, `${rawSession.serialized} `);
      return db;
    });
    await expect(binding.bind(identity)).rejects.toThrow(V1SourceChangedError);
    expect(close).toHaveBeenCalled();
    await expect(owner.sendDurable?.(['togglePlayerShortlisted', 'blocked'])).rejects.toThrow('Bind the harness session');
    expect(binding.errors.some(diagnostic => diagnostic.error instanceof V1SourceChangedError)).toBe(true);
  });

  it('reports a snapshot storage exception without opening a database', async () => {
    const storage = new SourceStorage();
    const { binding, open } = await harness(storage);
    const failure = new Error('Storage denied');
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw failure; });
    await expect(binding.bind(identity)).rejects.toThrow(failure);
    expect(open).not.toHaveBeenCalled();
    expect(binding.errors).toContainEqual({ phase: 'error', error: failure });
  });

  it('binds with unrelated orphans and reports their raw bytes', async () => {
    const journal = orphan(otherIdentity.draftId);
    const { owner, binding } = await harness(new SourceStorage([rawSession, journal]));
    await binding.bind(identity);
    await owner.sendDurable?.(['togglePlayerShortlisted', 'writable']);
    expect(owner.draft.getState().shortlistedPlayerIds).toEqual(['writable']);
    expect(reportedImport(binding.errors).imported.unresolved.map(({ key, serialized }) => ({ key, serialized }))).toEqual([journal]);
  });

  it('closes storage and leaves no writer when the requested identity has an unresolved journal', async () => {
    const journal = orphan(identity.draftId);
    const { binding, close, owner } = await harness(new SourceStorage([rawSession, journal]));
    await expect(binding.bind(identity)).rejects.toThrow(V1ImportDiagnostic);
    expect(close).toHaveBeenCalled();
    expect(reportedImport(binding.errors).imported.unresolved.map(({ key, serialized }) => ({ key, serialized }))).toEqual([journal]);
    await expect(owner.sendDurable?.(['togglePlayerShortlisted', 'blocked'])).rejects.toThrow('Bind the harness session');
  });

  it('closes a failed refresh and does not retain the disposed writer after rebind failure', async () => {
    const storage = new SourceStorage();
    const { binding, owner, open, close } = await harness(storage);
    await binding.bind(identity);
    const nextDatabase = await database();
    const closeNext = vi.spyOn(nextDatabase, 'close');
    open.mockResolvedValueOnce(nextDatabase);
    const failure = new Error('Refresh failed');
    vi.spyOn(nextDatabase, 'read').mockRejectedValueOnce(failure);
    await expect(binding.bind(identity)).rejects.toThrow(failure);
    expect(close).toHaveBeenCalled();
    expect(closeNext).toHaveBeenCalled();
    await expect(owner.sendDurable?.(['togglePlayerShortlisted', 'blocked'])).rejects.toThrow('Bind the harness session');
  });

  it('closes the candidate when the source changes during its initial refresh', async () => {
    const storage = new SourceStorage();
    const { db, binding, close, owner } = await harness(storage);
    const read = db.read.bind(db);
    vi.spyOn(db, 'read').mockImplementation(async requested => {
      const result = await read(requested);
      storage.entries.set(sessionKey, `${rawSession.serialized} `);
      return result;
    });
    await expect(binding.bind(identity)).rejects.toThrow(V1SourceChangedError);
    expect(close).toHaveBeenCalled();
    await expect(owner.sendDurable?.(['togglePlayerShortlisted', 'blocked'])).rejects.toThrow('Bind the harness session');
  });
});
