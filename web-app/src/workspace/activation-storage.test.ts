// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS, createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { DRAFT_STORAGE_MIGRATION_KEY, isDraftStorageMigration } from '@fantasy-draft/shared/sync';
import type { PersistedDraftSession } from '@/stores/draftSessionStorage';
import type { DraftSessionChange } from '@/stores/draftSessionUnconfirmedSaves';
import type { RecordedDraftPick } from '@/stores/draft/types';
import {
  ActivationCancelledError, ActivationStaleError, createActivationStorage,
  type ActivationController, type ActivationDecision, type ActivationReview,
} from './activation-storage';
import { ACTIVATION_RECORD, DRAFT_DATABASE, IMPORT_METADATA, openDraftDatabase, type DraftDatabase, type StorageDiagnostic } from './indexed-db';
import { decodeIndexedSession } from './idb-session';
import * as indexedDatabase from './indexed-db';

const HEAD = 'fantasy-draft-session-v1:sleeper:123';
const OTHER = 'fantasy-draft-session-v1:sleeper:456';
const JOURNAL = 'fantasy-draft-session-unconfirmed-v1:sleeper:123:tab';
const confirmed = { otherTabsClosed: true } as const;

function pick(pickNumber: number): RecordedDraftPick {
  return { pickNumber, playerId: `player-${pickNumber}`, playerName: `Player ${pickNumber}`, position: 'WR', teamIndex: 0, teamName: 'Team 1', timestamp: 123, source: 'manual' };
}

function session(overrides: Partial<PersistedDraftSession> = {}, draftId = '123'): PersistedDraftSession {
  return {
    version: 1, revision: 1, lineage: ['base'], identity: { provider: 'sleeper', draftId },
    config: { totalTeams: 10, totalRounds: 14, draftType: 'snake', myPickPosition: 5, rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS },
    leagueSettings: createDefaultLeagueSettings(123), currentPick: 3,
    draftProgress: { anchor: { kind: 'carry', pickNumber: 3 }, historyLength: 2 }, draftHistory: [pick(1), pick(2)],
    shortlistedPlayerIds: ['queued'], preloadedKeepers: [{ playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 2, round: 4, isMyKeeper: false }],
    keepersInitialized: true, unresolvedProviderPicks: [], decisionLens: 'best-pick', manualContinuityBaselineAt: 5,
    lastConfirmedSyncAt: null, lastConfirmedPickNumber: 0, ...overrides,
  };
}

function journal(overrides: Partial<DraftSessionChange> = {}): string {
  return JSON.stringify({ version: 1, writeId: 'journal', baseWriteId: 'base', revision: 2, picks: [], fields: {}, queueAdded: [], queueRemoved: [], ...overrides });
}

const conflictingContinuityWithMergeableQueue = journal({ fields: { manualContinuityBaselineAt: { before: 10, after: 20 } }, queueAdded: ['journal-only'] });

let factory: IDBFactory;
let diagnostics: StorageDiagnostic[];
const opened: { close(): void }[] = [];

beforeEach(() => { localStorage.clear(); factory = new IDBFactory(); diagnostics = []; });
afterEach(() => { restoreMocks(); for (const handle of opened.splice(0)) handle.close(); localStorage.clear(); });

function controller(options: { timeoutMs?: number; factory?: IDBFactory } = {}): ActivationController {
  const value = createActivationStorage({ storage: localStorage, factory: options.factory ?? factory, report: diagnostic => { diagnostics.push(diagnostic); }, now: () => 1_000, ...options.timeoutMs ? { timeoutMs: options.timeoutMs } : {} });
  opened.push(value);
  return value;
}

async function inspect(): Promise<DraftDatabase> {
  const database = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: () => undefined });
  opened.push(database);
  return database;
}

function reviewed(review: ActivationReview): Extract<ActivationReview, { status: 'review' }> {
  if (review.status !== 'review') throw new Error(`Expected a review, got ${review.status}`);
  return review;
}

function decide(review: ActivationReview, action: ActivationDecision['action'], kind?: string): ActivationDecision[] {
  return reviewed(review).blockers.filter(blocker => !kind || blocker.kind === kind).map(blocker => ({ blockerId: blocker.id, digest: blocker.digest, action }));
}

async function activationRecord(): Promise<Record<string, unknown>> {
  const row = (await (await inspect()).snapshot()).metadata.find(entry => entry.key === ACTIVATION_RECORD);
  if (typeof row?.value !== 'object' || row.value === null) throw new Error('Expected an activation record');
  return { ...row.value };
}

function objectStoreMethod(method: 'put' | 'get' | 'delete') {
  const original: unknown = Object.getOwnPropertyDescriptor(FakeObjectStore.prototype, method)?.value;
  if (typeof original !== 'function') throw new Error(`Missing IndexedDB ${method} implementation`);
  return (receiver: IDBObjectStore, args: readonly unknown[]): unknown => Reflect.apply(original, receiver, args);
}

const interceptions: (() => void)[] = [];
function interceptObjectStore(method: 'put' | 'get' | 'delete', implementation: (this: IDBObjectStore, ...args: unknown[]) => unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(FakeObjectStore.prototype, method);
  if (!descriptor) throw new Error(`Missing IndexedDB ${method} descriptor`);
  Object.defineProperty(FakeObjectStore.prototype, method, { ...descriptor, value: implementation });
  const mockRestore = (): void => { Object.defineProperty(FakeObjectStore.prototype, method, descriptor); };
  interceptions.push(mockRestore);
  return { mockRestore };
}
function restoreMocks(): void {
  vi.restoreAllMocks();
  for (const restore of interceptions.splice(0).reverse()) restore();
}

describe('storage activation preflight', () => {
  it('probes and dry-runs without writing imports or the tombstone', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    const review = reviewed(await controller().preflight());
    expect(review).toMatchObject({ phase: 'fresh', ready: true, blockers: [], tombstone: 'absent' });
    expect(review.source).toEqual([{ key: HEAD, serialized: localStorage.getItem(HEAD) }]);
    expect(review.sessions.map(row => row.draftHistory.map(entry => entry.pickNumber))).toEqual([[1, 2]]);
    const snapshot = await (await inspect()).snapshot();
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.metadata).toEqual([]);
    expect(await probeCount()).toBe(0);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('keeps users on v1 when IndexedDB cannot open', async () => {
    const broken = { open: () => { throw new DOMException('Private mode', 'InvalidStateError'); } } as unknown as IDBFactory;
    const review = await controller({ factory: broken }).preflight();
    expect(review).toMatchObject({ status: 'unavailable', reason: 'unavailable' });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('reports a blocked open as a close-other-tabs message', async () => {
    const blocked = { open: () => {
      const request = { result: undefined, error: null } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => { request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent); });
      return request;
    } } as unknown as IDBFactory;
    expect(await controller({ factory: blocked }).preflight()).toMatchObject({ status: 'unavailable', reason: 'blocked' });
  });

  it('times out an open request that never settles', async () => {
    const silent = { open: () => ({}) as IDBOpenDBRequest } as unknown as IDBFactory;
    expect(await controller({ factory: silent, timeoutMs: 20 }).preflight()).toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });

  it('classifies a quota failure on the probe write', async () => {
    const put = objectStoreMethod('put');
    interceptObjectStore('put', function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'probes') throw new DOMException('Full', 'QuotaExceededError');
      return put(this, args);
    });
    expect(await controller().preflight()).toMatchObject({ status: 'unavailable', reason: 'quota' });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it.each(['read', 'delete'] as const)('does not activate when the actual probe %s fails', async phase => {
    const get = objectStoreMethod('get');
    const remove = objectStoreMethod('delete');
    let reads = 0;
    let deletes = 0;
    interceptObjectStore('get', function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'probes' && ++reads === 2 && phase === 'read') throw new DOMException('Probe read denied', 'InvalidStateError');
      return get(this, args);
    });
    interceptObjectStore('delete', function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'probes' && ++deletes === 1 && phase === 'delete') throw new DOMException('Probe delete denied', 'InvalidStateError');
      return remove(this, args);
    });
    const review = await controller().preflight();
    expect(review).toMatchObject({ status: 'unavailable', reason: 'unavailable' });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
    restoreMocks();
    expect(await probeCount()).toBe(0);
    expect((await (await inspect()).snapshot()).metadata).toEqual([]);
  });

  it('rechecks storage usability at activation and never writes a tombstone after a new quota failure', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    const activation = controller();
    await activation.preflight();
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('New quota failure', 'QuotaExceededError'); });
    await expect(activation.activate([], confirmed)).rejects.toMatchObject({ name: 'ActivationUnavailableError', review: { reason: 'quota' } });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
    restoreMocks();
    expect((await (await inspect()).snapshot()).sessions).toEqual([]);
  });

  it('removes the probe even when the read-back differs', async () => {
    const get = objectStoreMethod('get');
    let reads = 0;
    interceptObjectStore('get', function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'probes' && ++reads === 2) return get(this, ['missing']);
      return get(this, args);
    });
    expect(await controller().preflight()).toMatchObject({ status: 'unavailable', reason: 'probe-mismatch' });
    restoreMocks();
    expect(await probeCount()).toBe(0);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });
});

async function probeCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DRAFT_DATABASE, 1);
    request.onsuccess = () => {
      const count = request.result.transaction(['probes']).objectStore('probes').count();
      count.onsuccess = () => { request.result.close(); resolve(count.result); };
      count.onerror = () => { reject(count.error ?? new Error('count failed')); };
    };
    request.onerror = () => { reject(request.error ?? new Error('open failed')); };
  });
}

describe('storage activation decisions', () => {
  it('requires the close-tabs confirmation and a decision for an unresolved journal', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    localStorage.setItem(JOURNAL, conflictingContinuityWithMergeableQueue);
    const activation = controller();
    const review = reviewed(await activation.preflight());
    expect(review.ready).toBe(false);
    expect(review.blockers).toMatchObject([{ id: `unresolved-journal:${JOURNAL}`, kind: 'unresolved-journal', entries: [{ key: JOURNAL, serialized: conflictingContinuityWithMergeableQueue }], actions: ['keep-imported', 'discard-entry'] }]);
    await expect(activation.activate([], { otherTabsClosed: false } as unknown as typeof confirmed)).rejects.toThrow(/other draft tabs/);
    await expect(activation.activate([], confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    expect((await (await inspect()).snapshot()).sessions).toEqual([]);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('previews keep and discard outcomes and imports the chosen one with raw bytes and decisions retained', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    localStorage.setItem(JOURNAL, conflictingContinuityWithMergeableQueue);
    const activation = controller();
    const first = await activation.preflight();
    const keep = reviewed(await activation.preflight(decide(first, 'keep-imported')));
    expect(keep.ready).toBe(true);
    expect(keep.sessions[0]?.shortlistedPlayerIds).toEqual(['queued', 'journal-only']);
    const discard = decide(first, 'discard-entry');
    const preview = reviewed(await activation.preflight(discard));
    expect(preview.sessions[0]?.shortlistedPlayerIds).toEqual(['queued']);
    const database = await activation.activate(discard, confirmed);
    expect((await database.read({ provider: 'sleeper', draftId: '123' }))?.shortlistedPlayerIds).toEqual(['queued']);
    const record = await activationRecord();
    expect(record).toMatchObject({ state: 'imported', source: preview.source, decisions: [{ decision: discard[0] }] });
    expect(localStorage.getItem(JOURNAL)).toBe(conflictingContinuityWithMergeableQueue);
    const tombstone: unknown = JSON.parse(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY) ?? 'null');
    expect(isDraftStorageMigration(tombstone)).toBe(true);
  });

  it('rejects a decision whose digest no longer matches the displayed entry', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    localStorage.setItem(JOURNAL, conflictingContinuityWithMergeableQueue);
    const activation = controller();
    const decisions = decide(await activation.preflight(), 'keep-imported').map(row => ({ ...row, digest: 'stale' }));
    const review = reviewed(await activation.preflight(decisions));
    expect(review).toMatchObject({ ready: false, stale: [`unresolved-journal:${JOURNAL}`] });
    await expect(activation.activate(decisions, confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
  });

  it('invalidates a journal decision when its source head changes the computed import', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    localStorage.setItem(JOURNAL, conflictingContinuityWithMergeableQueue);
    const activation = controller();
    const decisions = decide(await activation.preflight(), 'keep-imported');
    localStorage.setItem(HEAD, JSON.stringify(session({ shortlistedPlayerIds: ['different-head'] })));
    const review = reviewed(await activation.preflight(decisions));
    expect(review.ready).toBe(false);
    expect(review.stale).toEqual([`unresolved-journal:${JOURNAL}`]);
    await expect(activation.activate(decisions, confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('offers only discard for an undecodable head and still imports other drafts', async () => {
    localStorage.setItem(HEAD, '{"version":1,');
    localStorage.setItem(OTHER, JSON.stringify(session({}, '456')));
    const activation = controller();
    const review = reviewed(await activation.preflight());
    expect(review.blockers).toMatchObject([{ kind: 'invalid-record', entries: [{ key: HEAD, serialized: '{"version":1,' }], actions: ['discard-entry'] }]);
    expect(reviewed(await activation.preflight(decide(review, 'keep-imported'))).ready).toBe(false);
    const database = await activation.activate(decide(review, 'discard-entry'), confirmed);
    expect(await database.read({ provider: 'sleeper', draftId: '456' })).not.toBeNull();
    expect(await database.read({ provider: 'sleeper', draftId: '123' })).toBeNull();
    expect((await activationRecord()).source).toContainEqual({ key: HEAD, serialized: '{"version":1,' });
  });

  it('refuses activation when the v1 source changes after review, before any write', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    const activation = controller();
    await activation.preflight();
    localStorage.setItem(HEAD, JSON.stringify(session({ shortlistedPlayerIds: ['late'] })));
    await expect(activation.activate([], confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    expect((await (await inspect()).snapshot()).metadata).toEqual([]);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('never replaces acknowledged IndexedDB facts with a different v1 source', async () => {
    const identity = { provider: 'sleeper', draftId: '123' } as const;
    const database = await inspect();
    await database.importV1({ sessions: [session()], source: [], rejected: [], unresolved: [] });
    await database.update(identity, latest => ({ session: { ...latest ?? session(), revision: 5, shortlistedPlayerIds: ['acknowledged'] }, result: null }));
    localStorage.setItem(HEAD, JSON.stringify(session({ shortlistedPlayerIds: ['v1-late'] })));
    const activation = controller();
    const review = reviewed(await activation.preflight());
    expect(review.blockers).toMatchObject([{ kind: 'changed-source', actions: ['keep-imported'], comparison: { queue: { indexed: ['acknowledged'], incoming: ['v1-late'] } } }]);
    const activated = await activation.activate(decide(review, 'keep-imported'), confirmed);
    expect((await activated.read(identity))?.shortlistedPlayerIds).toEqual(['acknowledged']);
    const refusals = (await activated.snapshot()).metadata.filter(row => row.key.startsWith(`${IMPORT_METADATA}:refused:`));
    expect(refusals).toMatchObject([{ value: { acknowledged: { at: 1_000 }, source: [{ key: HEAD }] } }]);
  });

  it('surfaces undecodable IndexedDB rows that have no v1 source', async () => {
    const database = await inspect();
    await database.commit({ expect: {}, metadata: [] });
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(DRAFT_DATABASE, 1);
      request.onsuccess = () => {
        const tx = request.result.transaction(['sessions'], 'readwrite');
        tx.objectStore('sessions').put({ broken: true }, 'sleeper:999');
        tx.oncomplete = () => { request.result.close(); resolve(); };
        tx.onerror = () => { reject(tx.error ?? new Error('put failed')); };
      };
    });
    const review = reviewed(await controller().preflight());
    expect(review.blockers).toMatchObject([{ id: 'invalid-indexed:sleeper:999', kind: 'invalid-indexed', entries: [], actions: ['keep-imported'] }]);
  });
});

describe('storage activation crash recovery', () => {
  it('resumes after the tombstone write fails without importing twice', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    const first = controller();
    await first.preflight();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await expect(first.activate([], confirmed)).rejects.toThrow('Full');
    setItem.mockRestore();
    const committed = await activationRecord();
    const second = controller();
    expect(await second.resume()).toBeNull();
    const review = reviewed(await second.preflight());
    expect(review).toMatchObject({ phase: 'resume', ready: true, sessions: [] });
    await second.activate([], confirmed);
    expect(await activationRecord()).toEqual(committed);
    expect(isDraftStorageMigration(JSON.parse(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY) ?? 'null'))).toBe(true);
    const third = controller();
    expect(await third.resume()).not.toBeNull();
    expect(reviewed(await third.preflight())).toMatchObject({ phase: 'complete', ready: true });
  });

  it('requires a decision for v1 bytes that changed after the import was acknowledged', async () => {
    const identity = { provider: 'sleeper', draftId: '123' } as const;
    localStorage.setItem(HEAD, JSON.stringify(session()));
    const first = controller();
    await first.preflight();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('crash before tombstone'); });
    await expect(first.activate([], confirmed)).rejects.toThrow('crash before tombstone');
    restoreMocks();
    localStorage.setItem(HEAD, JSON.stringify(session({ shortlistedPlayerIds: ['stale-tab'] })));
    const second = controller();
    expect(await second.resume()).toBeNull();
    const review = reviewed(await second.preflight());
    expect(review).toMatchObject({ phase: 'resume', ready: false, blockers: [{ kind: 'changed-source', actions: ['keep-imported'] }] });
    await expect(second.activate([], confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    const database = await second.activate(decide(review, 'keep-imported'), confirmed);
    expect((await database.read(identity))?.shortlistedPlayerIds).toEqual(['queued']);
    expect(await activationRecord()).toMatchObject({ late: [{ source: review.source }] });
    expect(await controller().resume()).not.toBeNull();
  });

  it('stops before the tombstone when cancelled and leaves the handed-out database open on close', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    const cancelled = controller();
    await cancelled.preflight();
    cancelled.cancel();
    await expect(cancelled.activate([], confirmed)).rejects.toBeInstanceOf(ActivationCancelledError);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
    const activation = controller();
    await activation.preflight();
    const database = await activation.activate([], confirmed);
    activation.close();
    expect(await database.read({ provider: 'sleeper', draftId: '123' })).not.toBeNull();
    database.close();
  });
});


describe('global activation and atomic import', () => {
  it.each([
    { kind: 'invalid-record', key: JOURNAL, serialized: ' {"version":1, invalid journal bytes \n' },
    { kind: 'unresolved-journal', key: JOURNAL, serialized: journal({ baseWriteId: 'missing', queueAdded: ['orphaned'] }) },
    { kind: 'rejected-values', key: HEAD, serialized: JSON.stringify({ ...session(), shortlistedPlayerIds: ['kept', 12] }, null, 2) },
  ])('requires an explicit decision for $kind anywhere in the source', async ({ kind, key, serialized }) => {
    localStorage.setItem(key, serialized);
    localStorage.setItem(OTHER, JSON.stringify(session({}, '456')));
    const activation = controller();
    const review = reviewed(await activation.preflight());
    expect(review.ready).toBe(false);
    expect(review.blockers).toMatchObject([{ kind, entries: [{ key, serialized }] }]);
    await expect(activation.activate([], confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    expect((await (await inspect()).snapshot()).sessions).toEqual([]);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
    const database = await activation.activate(decide(review, 'discard-entry'), confirmed);
    opened.push(database);
    expect(await database.read({ provider: 'sleeper', draftId: '456' })).not.toBeNull();
    const record = await activationRecord();
    expect(record.source).toContainEqual({ key, serialized });
    expect(record).toMatchObject({ decisions: [{ decision: { action: 'discard-entry' }, blocker: { entries: [{ key, serialized }] } }] });
    expect(localStorage.getItem(key)).toBe(serialized);
  });

  it('keeps a corrupt IndexedDB row without a source after an explicit global decision', async () => {
    const database = await inspect();
    const request = factory.open(DRAFT_DATABASE, 1);
    const corrupt = { version: 1, raw: 'preserve exactly', nested: ['unreadable', 17] };
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const tx = request.result.transaction(['sessions'], 'readwrite');
        tx.objectStore('sessions').put(corrupt, 'sleeper:orphan');
        tx.oncomplete = () => { request.result.close(); resolve(); };
        tx.onabort = () => { reject(tx.error ?? new Error('Raw session transaction aborted')); };
      };
      request.onerror = () => { reject(request.error ?? new Error('Raw database open failed')); };
    });
    localStorage.setItem(OTHER, JSON.stringify(session({}, '456')));
    const activation = controller();
    const review = reviewed(await activation.preflight());
    expect(review).toMatchObject({ ready: false, blockers: [{ kind: 'invalid-indexed', entries: [] }] });
    await expect(activation.activate([], confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    await activation.activate(decide(review, 'keep-imported'), confirmed);
    expect((await database.snapshot()).invalid).toMatchObject([{ key: 'sleeper:orphan', value: corrupt, serialized: JSON.stringify(corrupt) }]);
    expect(await activationRecord()).toMatchObject({ decisions: [{ blocker: { kind: 'invalid-indexed' }, decision: { action: 'keep-imported' } }] });
  });

  it('acknowledges prior source refusals while preserving their exact raw bytes', async () => {
    const database = await inspect();
    const key = `${IMPORT_METADATA}:refused:sleeper:123:old`;
    const source = [{ key: HEAD, serialized: ' { "raw": "late source" } \n' }];
    await database.commit({ expect: {}, metadata: [{ key, value: { identity: session().identity, reason: 'changed source', source } }] });
    const activation = controller();
    const review = reviewed(await activation.preflight());
    expect(review).toMatchObject({ ready: false, blockers: [{ kind: 'prior-refusal', entries: source }] });
    await activation.activate(decide(review, 'keep-imported'), confirmed);
    expect((await database.snapshot()).metadata.find(row => row.key === key)?.value).toMatchObject({ source, acknowledged: { at: 1_000 } });
  });

  it('aborts every session and per-session marker if the global completion write fails', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    localStorage.setItem(OTHER, JSON.stringify(session({}, '456')));
    const activation = controller();
    await activation.preflight();
    const transactions: IDBTransaction[] = [];
    const put = objectStoreMethod('put');
    const failure = interceptObjectStore('put', function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'sessions' || this.name === 'metadata') transactions.push(this.transaction);
      if (args[1] === ACTIVATION_RECORD) throw new DOMException('completion quota', 'QuotaExceededError');
      return put(this, args);
    });
    await expect(activation.activate([], confirmed)).rejects.toThrow('completion quota');
    expect(transactions).toHaveLength(5);
    expect(new Set(transactions).size).toBe(1);
    expect(await (await inspect()).snapshot()).toEqual({ sessions: [], invalid: [], metadata: [] });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
    failure.mockRestore();
    const database = await activation.activate([], confirmed);
    opened.push(database);
    const snapshot = await database.snapshot();
    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.metadata.filter(row => row.key.startsWith(`${IMPORT_METADATA}:`))).toHaveLength(2);
    expect(await activationRecord()).toMatchObject({ state: 'imported', sessions: { 'sleeper:123': 1, 'sleeper:456': 1 } });
  });

  it('aborts the whole import if the raw source changes inside the commit', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    localStorage.setItem(OTHER, JSON.stringify(session({}, '456')));
    const activation = controller();
    await activation.preflight();
    const put = objectStoreMethod('put');
    interceptObjectStore('put', function (this: IDBObjectStore, ...args: unknown[]) {
      const request = put(this, args);
      if (args[1] === ACTIVATION_RECORD) localStorage.setItem(HEAD, `${localStorage.getItem(HEAD) ?? ''} `);
      return request;
    });
    await expect(activation.activate([], confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    expect(await (await inspect()).snapshot()).toEqual({ sessions: [], invalid: [], metadata: [] });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('detects an IndexedDB change after review and keeps the acknowledged facts', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session()));
    const activation = controller();
    await activation.preflight();
    const database = await inspect();
    await database.update(session().identity, () => ({ session: session({ revision: 7, shortlistedPlayerIds: ['acknowledged'] }), result: null }));
    await expect(activation.activate([], confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    expect((await database.read(session().identity))?.shortlistedPlayerIds).toEqual(['acknowledged']);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('resumes safely when cancelled after the import commits but before the tombstone', async () => {
    localStorage.setItem(HEAD, JSON.stringify(session(), null, 2));
    const activation = controller();
    await activation.preflight();
    const put = objectStoreMethod('put');
    const cancel = interceptObjectStore('put', function (this: IDBObjectStore, ...args: unknown[]) {
      const request = put(this, args);
      if (args[1] === ACTIVATION_RECORD) activation.cancel();
      return request;
    });
    await expect(activation.activate([], confirmed)).rejects.toBeInstanceOf(ActivationCancelledError);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
    const before = await (await inspect()).snapshot();
    expect(before.sessions).toHaveLength(1);
    expect(await activationRecord()).toMatchObject({ state: 'imported', source: [{ key: HEAD, serialized: localStorage.getItem(HEAD) }] });
    cancel.mockRestore();
    const retry = controller();
    expect(reviewed(await retry.preflight())).toMatchObject({ phase: 'resume', ready: true });
    const database = await retry.activate([], confirmed);
    opened.push(database);
    expect(await database.snapshot()).toEqual(before);
  });
});


describe('review r2 activation regressions', () => {
  it('invalidates a prior-refusal decision when displayed committed facts change', async () => {
    const database = await inspect();
    const key = `${IMPORT_METADATA}:refused:sleeper:123:prior`;
    await database.update(session().identity, () => ({ session: session({ revision: 2, shortlistedPlayerIds: ['ack-A'] }), result: null }));
    await database.commit({ expect: {}, metadata: [{ key, value: { identity: session().identity, reason: 'refused source', source: [{ key: HEAD, serialized: JSON.stringify(session()) }] } }] });
    const activation = controller();
    const first = reviewed(await activation.preflight());
    const decisions = decide(first, 'keep-imported');
    await database.update(session().identity, latest => ({ session: { ...latest ?? session(), revision: 3, shortlistedPlayerIds: ['ack-B'] }, result: null }));
    const next = reviewed(await activation.preflight(decisions));
    expect(first.blockers[0]?.indexed?.shortlistedPlayerIds).toEqual(['ack-A']);
    expect(next.blockers[0]?.indexed?.shortlistedPlayerIds).toEqual(['ack-B']);
    expect(next.blockers[0]?.digest).not.toBe(first.blockers[0]?.digest);
    expect(next).toMatchObject({ ready: false, stale: [`prior-refusal:${key}`] });
  });

  it.each(['invalid-record', 'unresolved-journal', 'rejected-values', 'changed-source', 'prior-refusal'] as const)(
    'invalidates a %s decision when its displayed IndexedDB head changes', async kind => {
      const database = await inspect();
      await database.update(session().identity, () => ({ session: session({ revision: 2, shortlistedPlayerIds: ['indexed-before'] }), result: null }));
      localStorage.setItem(HEAD, JSON.stringify(session()));
      if (kind === 'invalid-record') localStorage.setItem(JOURNAL, 'undecodable journal');
      if (kind === 'unresolved-journal') localStorage.setItem(JOURNAL, journal({ baseWriteId: 'missing-base', queueAdded: ['retained-only'] }));
      if (kind === 'rejected-values') localStorage.setItem(HEAD, JSON.stringify({ ...session(), shortlistedPlayerIds: ['valid', 17] }));
      if (kind === 'prior-refusal') await database.commit({ expect: {}, metadata: [{ key: `${IMPORT_METADATA}:refused:sleeper:123:prior`,
        value: { identity: session().identity, reason: 'prior refusal', source: [{ key: HEAD, serialized: JSON.stringify(session()) }] } }] });
      const activation = controller();
      const first = reviewed(await activation.preflight());
      const original = first.blockers.find(row => row.kind === kind);
      if (!original) throw new Error(`Missing ${kind} blocker`);
      const action = original.actions[0];
      if (!action) throw new Error('Missing decision action');
      const decisions = [{ blockerId: original.id, digest: original.digest, action }];
      await database.update(session().identity, latest => ({ session: { ...latest ?? session(), revision: 3, shortlistedPlayerIds: ['indexed-after'] }, result: null }));
      const next = reviewed(await activation.preflight(decisions));
      expect(next.blockers.find(row => row.id === original.id)?.indexed?.shortlistedPlayerIds).toEqual(['indexed-after']);
      expect(next.blockers.find(row => row.id === original.id)?.digest).not.toBe(original.digest);
      expect(next.stale).toContain(original.id);
      expect(next.ready).toBe(false);
    });

  it('invalidates an invalid-indexed decision when the displayed raw row changes', async () => {
    const raw = async (value: unknown): Promise<void> => new Promise((resolve, reject) => {
      const request = factory.open(DRAFT_DATABASE, 1);
      request.onsuccess = () => {
        const tx = request.result.transaction(['sessions'], 'readwrite');
        tx.objectStore('sessions').put(value, 'sleeper:orphan');
        tx.oncomplete = () => { request.result.close(); resolve(); };
        tx.onabort = () => { request.result.close(); reject(tx.error ?? new Error('Raw write failed')); };
      };
      request.onerror = () => { reject(request.error ?? new Error('Raw open failed')); };
    });
    await inspect();
    await raw({ invalid: 'before' });
    const activation = controller();
    const first = reviewed(await activation.preflight());
    const decisions = decide(first, 'keep-imported', 'invalid-indexed');
    await raw({ invalid: 'after' });
    const next = reviewed(await activation.preflight(decisions));
    expect(next.indexed.invalid[0]?.value).toEqual({ invalid: 'after' });
    expect(next.blockers[0]?.digest).not.toBe(first.blockers[0]?.digest);
    expect(next.stale).toEqual(['invalid-indexed:sleeper:orphan']);
    expect(next.ready).toBe(false);
  });

  it('closes a late successful open after timeout without replacing the retry database', async () => {
    const late = await inspect();
    const retry = await inspect();
    const close = vi.spyOn(late, 'close');
    let complete: ((database: DraftDatabase) => void) | undefined;
    vi.spyOn(indexedDatabase, 'openDraftDatabase').mockReturnValueOnce(new Promise(resolve => { complete = resolve; })).mockResolvedValue(retry);
    const activation = controller({ timeoutMs: 10 });
    expect(await activation.resume()).toBeNull();
    expect(await activation.preflight()).toMatchObject({ status: 'review', ready: true });
    complete?.(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    expect(await activation.preflight()).toMatchObject({ status: 'review', ready: true });
  });

  it('bounds the actual resume-first startup path for a silent open', async () => {
    const silent = { open: () => ({}) as IDBOpenDBRequest } as unknown as IDBFactory;
    const activation = controller({ factory: silent, timeoutMs: 10 });
    const result = await Promise.race([activation.resume().then(value => ({ settled: true, value })), new Promise(resolve => { setTimeout(() => { resolve('still pending after 100ms'); }, 100); })]);
    expect(result).toEqual({ settled: true, value: null });
    expect(await activation.preflight()).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('bounds a stalled snapshot during resume and preflight', async () => {
    const database = await inspect();
    vi.spyOn(indexedDatabase, 'openDraftDatabase').mockResolvedValue(database);
    vi.spyOn(database, 'snapshot').mockImplementation(() => new Promise(() => undefined));
    const activation = controller({ timeoutMs: 10 });
    expect(await activation.resume()).toBeNull();
    expect(await activation.preflight()).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('bounds cleanup even when the last probe call never settles', async () => {
    const database = await inspect();
    vi.spyOn(indexedDatabase, 'openDraftDatabase').mockResolvedValue(database);
    const probe = database.probe.bind(database);
    let calls = 0;
    vi.spyOn(database, 'probe').mockImplementation((key, value) => ++calls === 4 ? new Promise(() => undefined) : probe(key, value));
    const activation = controller({ timeoutMs: 10 });
    const result = await Promise.race([activation.preflight(), new Promise(resolve => { setTimeout(() => { resolve('still pending after 100ms'); }, 100); })]);
    expect(result).toMatchObject({ status: 'review', ready: true });
    expect(calls).toBe(4);
    expect(await probeCount()).toBe(0);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });
});


describe('atomic activation review boundary', () => {
  it.each(['prior-refusal', 'new-session', 'new-metadata', 'resume'] as const)('refuses %s facts changed after its final review snapshot', async kind => {
    const database = await inspect();
    const identity = session().identity;
    await database.update(identity, () => ({ session: session(), result: null }));
    if (kind === 'prior-refusal') await database.commit({ expect: {}, metadata: [{ key: `${IMPORT_METADATA}:refused:sleeper:123:prior`,
      value: { identity, reason: 'prior refusal', source: [{ key: HEAD, serialized: JSON.stringify(session()) }] } }] });
    if (kind === 'resume') {
      const initial = controller(); await initial.preflight(); await initial.activate([], confirmed);
      localStorage.removeItem(DRAFT_STORAGE_MIGRATION_KEY);
    }
    vi.spyOn(indexedDatabase, 'openDraftDatabase').mockResolvedValue(database);
    const activation = controller(); const first = reviewed(await activation.preflight());
    const decisions = decide(first, 'keep-imported');
    const commit = database.commit.bind(database); let interleaved = false;
    vi.spyOn(database, 'commit').mockImplementation(async request => {
      if (!interleaved) {
        interleaved = true;
        if (kind === 'new-session') await database.update(session({}, '456').identity, () => ({ session: session({}, '456'), result: null }));
        else if (kind === 'new-metadata') await commit({ expect: {}, metadata: [{ key: 'new-retained-fact', value: { acknowledged: true } }] });
        else await database.update(identity, latest => ({ session: { ...latest ?? session(), revision: 2, shortlistedPlayerIds: ['ack-after-review'] }, result: null }));
      }
      return commit(request);
    });
    await expect(activation.activate(decisions, confirmed)).rejects.toBeInstanceOf(ActivationStaleError);
    expect(interleaved).toBe(true);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
    if (kind === 'prior-refusal' || kind === 'resume') expect((await database.read(identity))?.shortlistedPlayerIds).toEqual(['ack-after-review']);
  });
});
