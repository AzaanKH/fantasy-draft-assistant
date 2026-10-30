// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS, createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { deriveDraftCursor, type DraftProgress } from '@fantasy-draft/shared/draft';
import { DRAFT_STORAGE_MIGRATION_KEY } from '@fantasy-draft/shared/sync';
import { parseStoredDraftSession, type PersistedDraftSession } from '@/stores/draftSessionStorage';
import type { RecordedDraftPick } from '@/stores/draft/types';
import { createActivationStorage, type ActivationController } from './activation-storage';
import { ACTIVATION_RECORD, DRAFT_DATABASE, DraftWritersStoppedError, digest, openDraftDatabase, type DraftDatabase } from './indexed-db';
import { decodeIndexedSession } from './idb-session';
import { readDraftSessionChanges } from '@/stores/draftSessionUnconfirmedSaves';
import {
  ROLLBACK_METADATA, ROLLBACK_READERS, digestRollbackFacts, digestRollbackJournals, finalizeRollback, prepareRollback, recoverRollbackExport, rollbackFacts, toV1Session, writeRollbackExport,
  type RollbackDecision, type RollbackExport, type RollbackVerification,
} from './rollback-export';

const HEAD = 'fantasy-draft-session-v1:sleeper:123';
const OTHER = 'fantasy-draft-session-v1:sleeper:456';
const JOURNAL = 'fantasy-draft-session-unconfirmed-v1:sleeper:123:stale-tab';
const confirmation = { otherTabsClosed: true, operator: 'test operator' } as const;
const handles: { close(): void }[] = [];
let factory: IDBFactory;

beforeEach(() => { factory = new IDBFactory(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); for (const handle of handles.splice(0)) handle.close(); localStorage.clear(); });

function pick(pickNumber: number): RecordedDraftPick {
  return { pickNumber, playerId: `p${pickNumber}`, playerName: `Player ${pickNumber}`, position: 'WR', teamIndex: pickNumber - 1,
    teamName: `Team ${pickNumber}`, timestamp: 100 + pickNumber, source: 'manual' };
}

function session(draftId = '123'): PersistedDraftSession {
  return {
    version: 1, identity: { provider: 'sleeper', draftId }, revision: 7, lineage: ['base', 'branch'],
    config: { totalTeams: 10, totalRounds: 14, draftType: 'snake', myPickPosition: 5, rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS },
    leagueSettings: createDefaultLeagueSettings(123), currentPick: 3,
    draftProgress: { anchor: { kind: 'carry', pickNumber: 3 }, historyLength: 2 }, draftHistory: [pick(1), pick(2)],
    shortlistedPlayerIds: ['third', 'first', 'second'],
    preloadedKeepers: [{ playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 2, round: 4, isMyKeeper: false }],
    keepersInitialized: true,
    unresolvedProviderPicks: [{ pickNumber: 4, playerId: 'provider-player', playerName: 'Unknown Player', nflTeam: null }],
    decisionLens: 'best-player', manualContinuityBaselineAt: 10, lastConfirmedSyncAt: 15, lastConfirmedPickNumber: 2,
  };
}

async function databaseHandle(): Promise<DraftDatabase> {
  const value = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: () => undefined });
  handles.push(value);
  return value;
}

function controller(): ActivationController {
  const value = createActivationStorage({ factory, storage: localStorage, report: () => undefined, now: () => 1_000 });
  handles.push(value);
  return value;
}

async function activated(): Promise<DraftDatabase> {
  localStorage.setItem(HEAD, ` \n${JSON.stringify(session(), null, 2)}\n`);
  localStorage.setItem(OTHER, JSON.stringify(session('456')));
  const activation = controller();
  await activation.preflight();
  const value = await activation.activate([], { otherTabsClosed: true });
  handles.push(value);
  await value.commit({ expect: {}, metadata: [{ key: 'retained-operator-data', value: { exact: ' \nraw bytes\t', refused: ['one', 'two'] } }] });
  return value;
}

function syntheticVerification(value: RollbackExport): RollbackVerification {
  return { exportDigest: value.digest, verifiedAt: 2_000, verifiedBy: 'unit test', readers: ROLLBACK_READERS.flatMap(reader =>
    (['load', 'writeback'] as const).map(phase => ({ commit: reader.commit, phase, factsDigest: value.expectedFactsDigest, journalsDigest: value.expectedJournalsDigest, moduleDigest: 'a'.repeat(64) }))) };
}

async function written(): Promise<{ database: DraftDatabase; exported: RollbackExport }> {
  const value = await activated();
  const exported = await prepareRollback(value);
  await writeRollbackExport({ database: value, storage: localStorage, export: exported });
  return { database: value, exported };
}

async function explicitlyKeepIndexed(value: DraftDatabase): Promise<RollbackExport> {
  const review = await prepareRollback(value, { storage: localStorage });
  return prepareRollback(value, { storage: localStorage, decisions: review.reconciliation.blockers.map(blocker =>
    ({ blockerId: blocker.id, digest: blocker.digest, action: 'keep-indexed' })) });
}

async function corruptRow(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(DRAFT_DATABASE, 1);
    request.onsuccess = () => {
      const tx = request.result.transaction(['sessions'], 'readwrite');
      tx.objectStore('sessions').put({ undecodable: true, raw: 'retain me' }, 'sleeper:corrupt');
      tx.oncomplete = () => { request.result.close(); resolve(); };
      tx.onabort = () => { request.result.close(); reject(tx.error ?? new Error('Raw session transaction aborted')); };
    };
    request.onerror = () => { reject(request.error ?? new Error('Raw database open failed')); };
  });
}

async function state(value: DraftDatabase): Promise<unknown> {
  return (await value.snapshot()).metadata.find(row => row.key === ACTIVATION_RECORD)?.value;
}

describe('rollback preparation', () => {
  it('fences writers in other database handles before exporting every fact and metadata record', async () => {
    const value = await activated();
    await corruptRow();
    const other = await databaseHandle();
    const exported = await prepareRollback(value);
    expect(await state(other)).toMatchObject({ state: 'rolling-back' });
    await expect(other.update(session().identity, latest => ({ session: latest ?? session(), result: null }))).rejects.toBeInstanceOf(DraftWritersStoppedError);
    await expect(other.importV1({ sessions: [session('new')], source: [], rejected: [], unresolved: [] })).rejects.toBeInstanceOf(DraftWritersStoppedError);
    const snapshot = await value.snapshot();
    expect(exported.sessions).toEqual(snapshot.sessions.map(row => ({ key: row.key, revision: row.session.revision, serialized: row.serialized })));
    expect(exported.invalid).toEqual(snapshot.invalid);
    expect(exported.retained).toEqual(snapshot.metadata.filter(row => !row.key.startsWith(`${ROLLBACK_METADATA}:`)).map(({ key, value }) => ({ key, value })));
    expect(exported.retained.find(row => row.key === ACTIVATION_RECORD)?.value).toMatchObject({ source: [{ key: HEAD, serialized: localStorage.getItem(HEAD) }, { key: OTHER }] });
    expect(exported.writes.map(row => row.key)).toEqual([HEAD, OTHER]);
    const parsed = exported.writes.map(row => parseStoredDraftSession(row.serialized, row.key === HEAD ? session().identity : session('456').identity));
    expect(parsed.every(row => row !== null)).toBe(true);
    expect(rollbackFacts(parsed)).toEqual(rollbackFacts(snapshot.sessions.map(row => row.session)));
    expect(await digestRollbackFacts(rollbackFacts(parsed))).toBe(exported.expectedFactsDigest);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
    expect(await recoverRollbackExport(value)).toEqual(exported);
  });

  it('blocks normal activation while rollback has fenced the database', async () => {
    await prepareRollback(await activated());
    const activation = controller();
    expect(await activation.resume()).toBeNull();
    expect(await activation.preflight()).toMatchObject({ status: 'rollback-in-progress' });
  });
});

describe('v1 progress and semantic compatibility', () => {
  it.each([
    { name: 'pick-order imported prefix', history: [pick(3), pick(1), pick(2)], progress: { anchor: { kind: 'branch', pickNumber: 1 }, historyLength: 1, historyPrefix: [1] } satisfies DraftProgress },
    { name: 'native insertion-order prefix', history: [pick(3), pick(1), pick(2)], progress: { anchor: { kind: 'carry', pickNumber: 1 }, historyLength: 1, historyPrefix: [3] } satisfies DraftProgress },
  ])('translates $name so insertion-order and pick-sorted readers derive the same saved cursor', ({ history, progress }) => {
    const input = { ...session(), draftHistory: history, draftProgress: progress, currentPick: deriveDraftCursor(history, progress) };
    decodeIndexedSession(input);
    const exported = toV1Session(input);
    const parsed = parseStoredDraftSession(exported.serialized, input.identity);
    if (!parsed) throw new Error('v1 reader rejected translated progress');
    expect(parsed.draftProgress).toEqual({ anchor: { kind: 'carry', pickNumber: input.currentPick }, historyLength: history.length });
    expect(exported.translation).toMatchObject({ from: progress, to: parsed.draftProgress });
    expect(deriveDraftCursor(history, parsed.draftProgress)).toBe(input.currentPick);
    expect(deriveDraftCursor([...history].sort((a, b) => a.pickNumber - b.pickNumber), parsed.draftProgress)).toBe(input.currentPick);
    const raw: unknown = JSON.parse(exported.serialized);
    expect(raw).toMatchObject({ draftHistory: history });
    expect(parsed.draftHistory).toEqual([...history].sort((a, b) => a.pickNumber - b.pickNumber));
    expect(rollbackFacts([parsed])).toEqual(rollbackFacts([input]));
  });

  it('keeps compatible branch progress while dropping only the accepted prefix extension', () => {
    const input = { ...session(), draftHistory: [pick(1), pick(2), pick(3)], currentPick: 4,
      draftProgress: { anchor: { kind: 'branch', pickNumber: 1 }, historyLength: 1, historyPrefix: [1] } satisfies DraftProgress };
    const exported = toV1Session(input);
    const parsed = parseStoredDraftSession(exported.serialized, input.identity);
    expect(exported.translation).toBeNull();
    expect(parsed?.draftProgress).toEqual({ anchor: { kind: 'branch', pickNumber: 1 }, historyLength: 1 });
    expect(parsed?.draftHistory).toEqual(input.draftHistory);
  });

  it('compares complete pick, keeper, unresolved, config, continuity and queue facts', async () => {
    const input = session();
    const baseline = await digestRollbackFacts(rollbackFacts([input]));
    const changed: Partial<PersistedDraftSession>[] = [
      { config: { ...input.config, myPickPosition: 6 } },
      { leagueSettings: createDefaultLeagueSettings(456) },
      { currentPick: 4 }, { identity: { ...input.identity, draftId: 'another' } },
      { draftHistory: input.draftHistory.map(row => ({ ...row, playerName: 'Renamed' })) },
      { draftHistory: input.draftHistory.map(row => ({ ...row, provisionalRevision: 2, provisionalUpdatedAt: 998 })) },
      { draftHistory: input.draftHistory.map(row => ({ ...row, timestamp: 999, teamName: 'Other', source: 'sync' })) },
      { preloadedKeepers: input.preloadedKeepers.map(row => ({ ...row, isMyKeeper: true })) },
      { unresolvedProviderPicks: input.unresolvedProviderPicks.map(row => ({ ...row, nflTeam: 'KC' })) },
      { shortlistedPlayerIds: [...input.shortlistedPlayerIds].reverse() }, { keepersInitialized: false },
      { decisionLens: 'best-pick' }, { manualContinuityBaselineAt: null }, { lastConfirmedSyncAt: null }, { lastConfirmedPickNumber: 1 },
    ];
    for (const fields of changed) expect(await digestRollbackFacts(rollbackFacts([{ ...input, ...fields }]))).not.toBe(baseline);
    expect(await digestRollbackFacts(rollbackFacts([{ ...input, revision: 8, lineage: ['writeback'], draftProgress: { anchor: { kind: 'start' }, historyLength: 0 }, draftHistory: [...input.draftHistory].reverse() }]))).toBe(baseline);
  });
});

describe('writing a rollback export', () => {
  it('overwrites stale heads and retains exact journal bytes before deleting them', async () => {
    const value = await activated();
    localStorage.setItem(HEAD, 'stale v1 head');
    const raw = ' \n{"version":1,"undecodable":"journal"}\t';
    localStorage.setItem(JOURNAL, raw);
    const unrelated = 'fantasy-draft-session-unconfirmed-v1:sleeper:unrelated:tab';
    localStorage.setItem(unrelated, 'keep unrelated journal');
    const exported = await explicitlyKeepIndexed(value);
    const remove = localStorage.removeItem.bind(localStorage);
    const deleted: string[] = [];
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(key => { deleted.push(key); remove(key); });
    const commit = value.commit.bind(value);
    vi.spyOn(value, 'commit').mockImplementation(async request => {
      if (!request.metadata?.some(row => row.key.endsWith(':written'))) {
        expect(deleted).toEqual([]);
        expect(localStorage.getItem(JOURNAL)).toBe(raw);
      }
      await commit(request);
    });
    await writeRollbackExport({ database: value, storage: localStorage, export: exported });
    for (const row of exported.writes) expect(localStorage.getItem(row.key)).toBe(row.serialized);
    expect(deleted).toEqual([JOURNAL, unrelated]);
    expect(localStorage.getItem(unrelated)).toBeNull();
    const snapshot = await value.snapshot();
    expect(snapshot.metadata.find(row => row.key === `${ROLLBACK_METADATA}:${exported.digest}:pre-export`)?.value).toContainEqual({ key: JOURNAL, serialized: raw });
    expect(snapshot.metadata.find(row => row.key === `${ROLLBACK_METADATA}:${exported.digest}`)?.value).toEqual(exported);
    expect(await state(value)).toMatchObject({ state: 'rolling-back' });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
  });

  it('retries an interrupted write and retains new journal bytes before deleting them', async () => {
    const value = await activated();
    localStorage.setItem(JOURNAL, 'first stale journal');
    let exported = await explicitlyKeepIndexed(value);
    const set = localStorage.setItem.bind(localStorage);
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, serialized) => {
      if (key === OTHER) throw new DOMException('interrupted export', 'QuotaExceededError');
      set(key, serialized);
    });
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow('interrupted export');
    expect(localStorage.getItem(HEAD)).toBe(exported.writes.find(row => row.key === HEAD)?.serialized);
    expect(localStorage.getItem(JOURNAL)).toBe('first stale journal');
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
    failure.mockRestore();
    localStorage.setItem(JOURNAL, 'new journal after interruption');
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow(/reconcil/i);
    exported = await explicitlyKeepIndexed(value);
    await writeRollbackExport({ database: value, storage: localStorage, export: exported });
    expect(localStorage.getItem(JOURNAL)).toBeNull();
    const metadata = JSON.stringify((await value.snapshot()).metadata);
    expect(metadata).toContain('first stale journal');
    expect(metadata).toContain('new journal after interruption');
    await writeRollbackExport({ database: value, storage: localStorage, export: exported });
    expect(await recoverRollbackExport(value)).toEqual(exported);
  });

  it('retains metadata from earlier rollbacks in a new export', async () => {
    const value = await activated();
    const old = `${ROLLBACK_METADATA}:earlier-export:pre-export`;
    const retained = [{ key: JOURNAL, serialized: 'prior rollback journal' }];
    await value.commit({ expect: {}, metadata: [{ key: old, value: retained }] });
    const exported = await explicitlyKeepIndexed(value);
    expect(exported.retained).toContainEqual({ key: old, value: retained });
    await writeRollbackExport({ database: value, storage: localStorage, export: exported });
    expect(await recoverRollbackExport(value)).toEqual(exported);
  });

  it('does not delete a journal that changes while the retention transaction completes', async () => {
    const value = await activated();
    localStorage.setItem(JOURNAL, 'captured before commit');
    let exported = await explicitlyKeepIndexed(value);
    const commit = value.commit.bind(value);
    const race = vi.spyOn(value, 'commit').mockImplementation(async request => {
      await commit(request);
      localStorage.setItem(JOURNAL, 'late while retaining');
    });
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow(/changed while retaining/);
    expect(localStorage.getItem(JOURNAL)).toBe('late while retaining');
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
    race.mockRestore();
    exported = await explicitlyKeepIndexed(value);
    await writeRollbackExport({ database: value, storage: localStorage, export: exported });
    expect(localStorage.getItem(JOURNAL)).toBeNull();
    expect(JSON.stringify((await value.snapshot()).metadata)).toContain('late while retaining');
  });

  it('keeps journals when retaining their bytes fails', async () => {
    const value = await activated();
    localStorage.setItem(JOURNAL, 'unretained');
    const exported = await explicitlyKeepIndexed(value);
    vi.spyOn(value, 'commit').mockRejectedValue(new Error('retention failed'));
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow('retention failed');
    expect(localStorage.getItem(JOURNAL)).toBe('unretained');
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
  });

  it('refuses export writes without the marker or after committed facts change', async () => {
    const value = await activated();
    const exported = await prepareRollback(value);
    const marker = localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY);
    localStorage.removeItem(DRAFT_STORAGE_MIGRATION_KEY);
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow(/tombstone/);
    if (!marker) throw new Error('Expected a marker');
    localStorage.setItem(DRAFT_STORAGE_MIGRATION_KEY, marker);
    await value.commit({ expect: {}, sessions: [{ key: 'sleeper:123', session: { ...session(), revision: 99 } }] });
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow(/IndexedDB changed/);
  });
});

describe('rollback finalization', () => {
  it.each([
    { reason: 'wrong export', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, exportDigest: 'different' }) },
    { reason: 'no old readers', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, readers: [] }) },
    { reason: 'missing main load', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, readers: proof.readers.filter(row => !(row.commit === ROLLBACK_READERS[0].commit && row.phase === 'load')) }) },
    { reason: 'missing stack writeback', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, readers: proof.readers.filter(row => !(row.commit === ROLLBACK_READERS[1].commit && row.phase === 'writeback')) }) },
    { reason: 'mismatched facts', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, readers: proof.readers.map(row => ({ ...row, factsDigest: 'lost fact' })) }) },
    { reason: 'lost journal facts', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, readers: proof.readers.map(row => ({ ...row, journalsDigest: 'different journals' })) }) },
    { reason: 'invalid module digest', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, readers: proof.readers.map(row => ({ ...row, moduleDigest: 'unloaded module' })) }) },
    { reason: 'no verifier', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, verifiedBy: ' ' }) },
    { reason: 'invalid time', change: (proof: RollbackVerification): RollbackVerification => ({ ...proof, verifiedAt: NaN }) },
  ])('keeps the marker for $reason', async ({ change }) => {
    const { database, exported } = await written();
    const marker = localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY);
    await expect(finalizeRollback({ database, storage: localStorage, export: exported, verification: change(syntheticVerification(exported)), confirmation })).rejects.toThrow();
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBe(marker);
    expect(await state(database)).toMatchObject({ state: 'rolling-back' });
  });

  it('requires closed tabs and a named operator', async () => {
    const { database, exported } = await written();
    for (const invalid of [{ otherTabsClosed: false, operator: 'operator' }, { otherTabsClosed: true, operator: ' ' }]) {
      await expect(finalizeRollback({ database, storage: localStorage, export: exported, verification: syntheticVerification(exported), confirmation: invalid as typeof confirmation })).rejects.toThrow(/operator/);
      expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
    }
  });

  it.each(['head bytes', 'new journal', 'IndexedDB session', 'metadata'] as const)('keeps the marker when %s changes after verification', async kind => {
    const { database, exported } = await written();
    if (kind === 'head bytes') localStorage.setItem(HEAD, `${localStorage.getItem(HEAD) ?? ''} `);
    if (kind === 'new journal') localStorage.setItem(JOURNAL, 'late journal');
    if (kind === 'IndexedDB session') await database.commit({ expect: {}, sessions: [{ key: 'sleeper:123', session: { ...session(), revision: 99 } }] });
    if (kind === 'metadata') await database.commit({ expect: {}, metadata: [{ key: 'late-retained-fact', value: { raw: 'not exported' } }] });
    await expect(finalizeRollback({ database, storage: localStorage, export: exported, verification: syntheticVerification(exported), confirmation })).rejects.toThrow();
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
  });

  it('rejects tampered export bytes before writing or removing the marker', async () => {
    const { database, exported } = await written();
    const tampered = { ...exported, writes: exported.writes.map(row => ({ ...row, serialized: `${row.serialized} ` })) };
    await expect(writeRollbackExport({ database, storage: localStorage, export: tampered })).rejects.toThrow(/digest/);
    await expect(finalizeRollback({ database, storage: localStorage, export: tampered, verification: syntheticVerification(exported), confirmation })).rejects.toThrow(/digest/);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
  });

  it('rechecks exact v1 bytes after recording completion and keeps the marker on a late change', async () => {
    const { database, exported } = await written();
    const commit = database.commit.bind(database);
    const race = vi.spyOn(database, 'commit').mockImplementation(async request => {
      await commit(request);
      localStorage.setItem(HEAD, 'late byte change');
    });
    await expect(finalizeRollback({ database, storage: localStorage, export: exported, verification: syntheticVerification(exported), confirmation })).rejects.toThrow(/exported bytes/);
    expect(await state(database)).toMatchObject({ state: 'rolled-back' });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
    race.mockRestore();
    const head = exported.writes.find(row => row.key === HEAD);
    if (!head) throw new Error('Expected an exported head');
    localStorage.setItem(HEAD, head.serialized);
    await finalizeRollback({ database, storage: localStorage, export: exported, verification: syntheticVerification(exported), confirmation });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('records exact proof before marker removal and retries a crash at the final removal', async () => {
    const { database, exported } = await written();
    const proof = syntheticVerification(exported);
    const snapshot = await database.snapshot();
    const failure = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('crash before marker removal'); });
    await expect(finalizeRollback({ database, storage: localStorage, export: exported, verification: proof, confirmation })).rejects.toThrow('crash before marker removal');
    const completed = await state(database);
    expect(completed).toMatchObject({ state: 'rolled-back', rollback: { exportDigest: exported.digest, verification: proof, confirmation } });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
    failure.mockRestore();
    const recovered = await recoverRollbackExport(await databaseHandle());
    expect(recovered).toEqual(exported);
    if (!recovered) throw new Error('Missing export after finalization crash');
    await finalizeRollback({ database, storage: localStorage, export: recovered, verification: proof, confirmation });
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
    expect(await state(database)).toEqual(completed);
    const retained = await database.snapshot();
    expect(retained.sessions).toEqual(snapshot.sessions);
    expect(retained.metadata.find(row => row.key === `${ROLLBACK_METADATA}:${exported.digest}`)?.value).toEqual(exported);
    await finalizeRollback({ database, storage: localStorage, export: exported, verification: proof, confirmation });
    expect(await state(database)).toEqual(completed);
    await expect(database.update(session().identity, () => ({ session: session(), result: null }))).rejects.toBeInstanceOf(DraftWritersStoppedError);
  });
});


describe('retained rollback reconciliation', () => {
  function journal(writeId: string, playerId = writeId): string {
    return JSON.stringify({ version: 1, writeId, baseWriteId: 'missing-base', revision: 9,
      picks: [{ pickNumber: 3, before: null, after: { ...pick(3), playerId } }], queueAdded: [], queueRemoved: [], fields: {} });
  }

  it.each(['retained-source', 'historical-export'])('exports retained-only journal facts from %s as readable v1 bytes', async location => {
    const value = await activated();
    const entry = { key: JOURNAL, serialized: ` \n${journal('retained-only')}\t` };
    await value.commit({ expect: {}, metadata: [{ key: location === 'historical-export' ? `${ROLLBACK_METADATA}:historical` : 'retained-source',
      value: { source: [entry] } }] });
    const exported = await explicitlyKeepIndexed(value);
    expect(exported.writes.filter(row => row.key.startsWith('fantasy-draft-session-unconfirmed-v1:')).map(row => row.serialized)).toEqual([entry.serialized]);
    await writeRollbackExport({ database: value, storage: localStorage, export: exported });
    const decoded = readDraftSessionChanges(localStorage, session().identity).sort((a, b) => a.key.localeCompare(b.key));
    expect(decoded.map(row => row.change.picks[0]?.after?.playerId)).toEqual(['retained-only']);
    expect(exported.expectedJournalsDigest).toBe(await digestRollbackJournals(decoded));
    expect(exported.expectedJournalsDigest).not.toBe(await digestRollbackJournals([]));
    expect(exported.clearKeys.some(key => exported.writes.some(row => row.key === key))).toBe(false);
    expect(exported.journals[0]).toMatchObject({ coverage: 'unresolved', change: { baseWriteId: 'missing-base', writeId: 'retained-only', revision: 9 } });
    expect(exported.sessions.map(row => decodeIndexedSession(JSON.parse(row.serialized)).lineage)).toEqual([['base', 'branch'], ['base', 'branch']]);
    const preparedAgain = await explicitlyKeepIndexed(value);
    expect(preparedAgain.journals).toEqual(exported.journals);
  });

  it('exports a lineage-covered journal with its original meaning and bytes', async () => {
    const value = await activated();
    const serialized = journal('branch', 'already-covered');
    await value.commit({ expect: {}, metadata: [{ key: 'covered-journal', value: [{ key: JOURNAL, serialized }] }] });
    const exported = await explicitlyKeepIndexed(value);
    expect(exported.journals).toMatchObject([{ serialized, coverage: 'covered', change: { writeId: 'branch', baseWriteId: 'missing-base' } }]);
    await writeRollbackExport({ database: value, storage: localStorage, export: exported });
    expect(readDraftSessionChanges(localStorage, session().identity)).toHaveLength(1);
  });

  it('exports both same-key journal variants and retries exact bytes after an interruption', async () => {
    const value = await activated();
    const entries = [journal('same-write', 'variant-a'), journal('same-write', 'variant-b')].map(serialized => ({ key: JOURNAL, serialized }));
    await value.commit({ expect: {}, metadata: [{ key: 'same-key-variants', value: entries }] });
    const exported = await explicitlyKeepIndexed(value);
    const journals = exported.writes.filter(row => row.key.startsWith('fantasy-draft-session-unconfirmed-v1:'));
    expect(journals).toHaveLength(2);
    expect(new Set(journals.map(row => row.key)).size).toBe(2);
    const set = localStorage.setItem.bind(localStorage);
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, serialized) => {
      if (key === journals[1]?.key) throw new Error('interrupted journal export');
      set(key, serialized);
    });
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow('interrupted journal export');
    failure.mockRestore();
    const recovered = await recoverRollbackExport(await databaseHandle());
    expect(recovered).toEqual(exported);
    if (!recovered) throw new Error('Missing saved journal export');
    await writeRollbackExport({ database: value, storage: localStorage, export: recovered });
    const decoded = readDraftSessionChanges(localStorage, session().identity);
    expect(decoded.map(row => row.change.writeId)).toEqual(['same-write', 'same-write']);
    expect(decoded.map(row => row.change.picks[0]?.after?.playerId).sort()).toEqual(['variant-a', 'variant-b']);
    await writeRollbackExport({ database: value, storage: localStorage, export: recovered });
    expect(await recoverRollbackExport(value)).toEqual(exported);
    await finalizeRollback({ database: value, storage: localStorage, export: recovered, verification: syntheticVerification(recovered), confirmation });
    for (const row of journals) expect(localStorage.getItem(row.key)).toBe(row.serialized);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('blocks rollback bytes when a retained journal contains a recoverable pick absent from committed heads', async () => {
    const value = await activated();
    const retainedPick = { ...pick(3), playerId: 'retained-only' };
    const serialized = JSON.stringify({ version: 1, writeId: 'retained-write', baseWriteId: 'missing-base', revision: 9,
      picks: [{ pickNumber: 3, before: null, after: retainedPick }], queueAdded: [], queueRemoved: [], fields: {} });
    await value.commit({ expect: {}, metadata: [{ key: 'retained-journal-source', value: { source: [{ key: JOURNAL, serialized }] } }] });
    const exported = await prepareRollback(value);
    expect(exported).toMatchObject({ reconciliation: { blockers: [{ kind: 'retained-entry', entry: { key: JOURNAL, serialized } }], pending: [expect.any(String)] } });
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow(/reconcil/i);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
  });
});


describe('rollback recovery and decision boundaries', () => {
  it('returns null before preparation and recovers the exact export through a new handle', async () => {
    const value = await activated();
    expect(await recoverRollbackExport(value)).toBeNull();
    localStorage.setItem(JOURNAL, 'retained undecodable journal');
    const prepared = await prepareRollback(value, { storage: localStorage });
    expect(prepared.reconciliation.pending).toHaveLength(1);
    expect(await recoverRollbackExport(await databaseHandle())).toEqual(prepared);
    const approved = await explicitlyKeepIndexed(value);
    expect(approved.reconciliation.pending).toEqual([]);
    expect(await recoverRollbackExport(await databaseHandle())).toEqual(approved);
    await writeRollbackExport({ database: value, storage: localStorage, export: approved });
    const recovered = await recoverRollbackExport(await databaseHandle());
    expect(recovered).toEqual(approved);
    if (!recovered) throw new Error('Missing recovered export');
    await finalizeRollback({ database: value, storage: localStorage, export: recovered, verification: syntheticVerification(recovered), confirmation });
    expect(await recoverRollbackExport(await databaseHandle())).toEqual(approved);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });

  it('rejects changed committed facts and tampered saved exports on recovery', async () => {
    const value = await activated();
    const exported = await prepareRollback(value);
    await value.commit({ expect: {}, sessions: [{ key: 'sleeper:123', session: { ...session(), revision: 99 } }] });
    await expect(recoverRollbackExport(await databaseHandle())).rejects.toThrow(/IndexedDB changed/);
    await value.commit({ expect: {}, metadata: [{ key: `${ROLLBACK_METADATA}:${exported.digest}`, value: { ...exported, writes: [] } }] });
    await expect(recoverRollbackExport(await databaseHandle())).rejects.toThrow(/digest/);
  });

  it('rejects a malformed saved payload even when its digest matches', async () => {
    const value = await activated();
    const exported = await prepareRollback(value);
    const { digest: _digest, ...body } = exported;
    const malformed = { ...body, reconciliation: { blockers: 'bad', decisions: [], pending: [], stale: [] } };
    const checksum = await digest(malformed);
    await value.commit({ expect: {}, metadata: [{ key: `${ROLLBACK_METADATA}:${checksum}`, value: { ...malformed, digest: checksum } },
      { key: `${ROLLBACK_METADATA}:active`, value: checksum }] });
    await expect(recoverRollbackExport(value)).rejects.toThrow(/Invalid saved/);
  });

  it('requires reconciliation for facts found only inside an earlier saved rollback export', async () => {
    const value = await activated();
    const entry = { key: JOURNAL, serialized: 'only retained inside a historical export' };
    await value.commit({ expect: {}, metadata: [{ key: `${ROLLBACK_METADATA}:historical`, value: { writes: [], retained: [{ source: [entry] }] } }] });
    const exported = await prepareRollback(value, { storage: localStorage });
    expect(exported.reconciliation.blockers.map(row => row.entry)).toContainEqual(entry);
    expect(exported.reconciliation.pending).toHaveLength(1);
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow(/reconcil/i);
  });

  it('requires explicit decisions for each raw variant and refuses stale decisions', async () => {
    const value = await activated();
    const first = { key: JOURNAL, serialized: 'first retained variant' };
    const second = { key: JOURNAL, serialized: 'second retained variant' };
    await value.commit({ expect: {}, metadata: [{ key: 'prior-raw', value: { source: [first, second] } }] });
    const review = await prepareRollback(value);
    expect(review.reconciliation.blockers).toHaveLength(2);
    const blocker = review.reconciliation.blockers[0];
    if (!blocker) throw new Error('Missing blocker');
    const partial = await prepareRollback(value, { decisions: [{ blockerId: blocker.id, digest: blocker.digest, action: 'keep-indexed' }] });
    expect(partial.reconciliation.pending).toHaveLength(1);
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: partial })).rejects.toThrow(/reconcil/i);
    await expect(finalizeRollback({ database: value, storage: localStorage, export: partial, verification: syntheticVerification(partial), confirmation })).rejects.toThrow(/reconcil/i);
    const stale = await prepareRollback(value, { decisions: [{ blockerId: blocker.id, digest: 'old digest', action: 'keep-indexed' }] });
    expect(stale.reconciliation.stale).toEqual([blocker.id]);
    const unknownAction = { blockerId: blocker.id, digest: blocker.digest, action: 'discard' } as unknown as RollbackDecision;
    const refused = await prepareRollback(value, { decisions: [unknownAction] });
    expect(refused.reconciliation.decisions).toEqual([]);
    expect(refused.reconciliation.stale).toEqual([blocker.id]);
  });

  it('retains newly observed sources before write and rechecks them at finalization', async () => {
    const { database: value, exported } = await written();
    localStorage.setItem(JOURNAL, 'late retained fact');
    const pending = await prepareRollback(value, { storage: localStorage });
    expect(pending.reconciliation.pending).toHaveLength(1);
    localStorage.removeItem(JOURNAL);
    await expect(finalizeRollback({ database: value, storage: localStorage, export: exported, verification: syntheticVerification(exported), confirmation })).rejects.toThrow(/reconcil/i);
    const review = await prepareRollback(value, { storage: localStorage });
    expect(review.reconciliation.blockers.map(row => row.entry.serialized)).toContain('late retained fact');
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
  });

  it('requires an actual completed export write, even when v1 already holds the target bytes', async () => {
    const value = await activated();
    const exported = await prepareRollback(value);
    for (const row of exported.writes) localStorage.setItem(row.key, row.serialized);
    await expect(finalizeRollback({ database: value, storage: localStorage, export: exported, verification: syntheticVerification(exported), confirmation })).rejects.toThrow(/Write the rollback export/);
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).not.toBeNull();
  });
});


describe('exact interrupted export recovery', () => {
  it('retries a partial v1 write with the same recovered export and digest', async () => {
    const value = await activated();
    localStorage.setItem(JOURNAL, 'explicitly reconciled journal');
    const exported = await explicitlyKeepIndexed(value);
    const set = localStorage.setItem.bind(localStorage);
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, serialized) => {
      if (key === OTHER) throw new DOMException('crash during export', 'QuotaExceededError');
      set(key, serialized);
    });
    await expect(writeRollbackExport({ database: value, storage: localStorage, export: exported })).rejects.toThrow('crash during export');
    fail.mockRestore();
    const recovered = await recoverRollbackExport(await databaseHandle());
    expect(recovered).toEqual(exported);
    if (!recovered) throw new Error('Missing partial export');
    await writeRollbackExport({ database: value, storage: localStorage, export: recovered });
    await finalizeRollback({ database: value, storage: localStorage, export: recovered, verification: syntheticVerification(recovered), confirmation });
    expect(localStorage.getItem(JOURNAL)).toBeNull();
    expect(localStorage.getItem(DRAFT_STORAGE_MIGRATION_KEY)).toBeNull();
  });
});
