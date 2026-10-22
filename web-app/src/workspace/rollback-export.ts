import { decodeDraftSessionChange, decodeStoredDraftProgress } from '@fantasy-draft/shared/catalog';
import { decodeIndexedSession } from './idb-session';
import { DRAFT_STORAGE_MIGRATION_KEY } from '@fantasy-draft/shared/sync';
import { deriveDraftCursor, type DraftProgress } from '@fantasy-draft/shared/draft';
import type { PersistedDraftSession } from '@/stores/draftSessionStorage';
import { activationRecordOf, readTombstone, type ActivationRecord } from './activation-storage';
import { ACTIVATION_RECORD, digest, type DatabaseSnapshot, type DraftDatabase } from './indexed-db';
import { importV1, snapshotV1Storage, type RawV1Entry, type V1Import } from './v1-import';

const SESSION_PREFIX = 'fantasy-draft-session-v1:';
const JOURNAL_PREFIX = 'fantasy-draft-session-unconfirmed-v1:';
const confirmed = (value: unknown): boolean => value === true;
export const ROLLBACK_METADATA = 'fantasy-draft-rollback-v1';
const ACTIVE_EXPORT = `${ROLLBACK_METADATA}:active`;

/** Amendment 7's real old readers. Every rollback export must load and write back through both. */
export const ROLLBACK_READERS = [
  { name: 'origin/main', commit: '8f1d26a621f4893f0c948f282e464573dd57b679' },
  { name: 'stack tombstone release', commit: '41debb3ccf175f6b5bbeef1806a1486043602635' },
] as const;

/** A concrete retained variant the operator explicitly chooses to omit from writable v1 data. */
export interface RollbackBlocker {
  readonly id: string;
  readonly digest: string;
  readonly kind: 'retained-entry' | 'invalid-indexed';
  readonly entry: RawV1Entry;
  readonly indexed: PersistedDraftSession | null;
  readonly incoming: V1Import;
  readonly actions: readonly ['keep-indexed'];
}
export interface RollbackDecision { readonly blockerId: string; readonly digest: string; readonly action: 'keep-indexed' }
export interface RollbackOptions { readonly storage?: Storage; readonly decisions?: readonly RollbackDecision[] }
export class RollbackReconciliationError extends Error {
  constructor() { super('Review and reconcile every retained rollback entry before writing or finalizing. Prepare again if v1 bytes changed.'); this.name = 'RollbackReconciliationError'; }
}

export interface RollbackExport {
  readonly version: 1;
  /** SHA-256 over every other field; verification evidence binds to it. */
  readonly digest: string;
  /** v1 session heads, sorted by key. */
  readonly writes: readonly { readonly key: string; readonly serialized: string }[];
  /** Identity keys whose stale v1 journals are removed after their bytes are retained in IndexedDB. */
  readonly clearJournalsFor: readonly string[];
  /** IndexedDB rows as captured behind the writer fence. */
  readonly sessions: readonly { readonly key: string; readonly revision: number; readonly serialized: string }[];
  readonly invalid: DatabaseSnapshot['invalid'];
  /** Every metadata record: activation record, retained raw source, decisions, markers, refusals. */
  readonly retained: readonly { readonly key: string; readonly value: unknown }[];
  readonly translations: readonly { readonly key: string; readonly from: DraftProgress; readonly to: DraftProgress; readonly reason: string }[];
  readonly expectedFactsDigest: string;
  readonly expectedJournalsDigest: string;
  readonly reconciliation: {
    readonly blockers: readonly RollbackBlocker[];
    readonly decisions: readonly RollbackDecision[];
    readonly pending: readonly string[];
    readonly stale: readonly string[];
  };
  /** Exact additional v1 keys removed only after their concrete reconciliation decisions. */
  readonly clearKeys: readonly string[];
}

export interface RollbackReaderEvidence {
  /** Full commit SHA from ROLLBACK_READERS. */
  readonly commit: string;
  /** SHA-256 of the old module bundle the proof loaded. */
  readonly moduleDigest: string;
  readonly phase: 'load' | 'writeback';
  /** `digestRollbackFacts(rollbackFacts(sessions the old module loaded))`. */
  readonly factsDigest: string;
  /** Digest of decoded journals not covered by their written head lineage; the proof enumerates every raw journal key. */
  readonly journalsDigest: string;
}

export interface RollbackVerification {
  readonly exportDigest: string;
  readonly readers: readonly RollbackReaderEvidence[];
  readonly verifiedAt: number;
  readonly verifiedBy: string;
}

export interface RollbackConfirmation { readonly otherTabsClosed: true; readonly operator: string }

/** A session's semantic facts: every field except revision, lineage and progress metadata, with sorted keys. */
export type RollbackSessionFacts = { readonly key: string; readonly facts: unknown };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : record(value) ? Object.fromEntries(Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => [key, canonical(value[key])])) : value;
const bySlot = (field: (row: Record<string, unknown>) => number) => (value: unknown): unknown => {
  const rows: unknown[] = Array.isArray(value) ? value : [];
  return Array.isArray(value) ? [...rows].sort((a, b) => (record(a) ? field(a) : 0) - (record(b) ? field(b) : 0)) : value;
};
const NOT_FACTS = new Set(['revision', 'lineage', 'draftProgress']);

/**
 * The facts an old reader must load and write back unchanged. Accepts loose session objects so a proof
 * script can pass exactly what a pinned old module parsed. Picks, keepers and unresolved provider picks are
 * compared by slot because older readers sort them on load; queue order is compared as stored. Revision and
 * lineage advance on every write-back, and progress is translated for old readers, so they are excluded.
 */
export function rollbackFacts(sessions: readonly unknown[]): RollbackSessionFacts[] {
  const sortPicks = bySlot(row => Number(row.pickNumber));
  const sortKeepers = bySlot(row => Number(row.teamIndex) * 1_000 + Number(row.round));
  return sessions.map(session => {
    const value = record(session) ? session : {};
    const identity = record(value.identity) ? value.identity : {};
    const facts = Object.fromEntries(Object.entries(value).filter(([key]) => !NOT_FACTS.has(key)).map(([key, field]) => [key,
      key === 'draftHistory' || key === 'unresolvedProviderPicks' ? sortPicks(field) : key === 'preloadedKeepers' ? sortKeepers(field) : field]));
    return { key: `${String(identity.provider)}:${String(identity.draftId)}`, facts: canonical(facts) };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

export const digestRollbackJournals = (journals: readonly unknown[]): Promise<string> => digest(canonical(journals));

export const digestRollbackFacts = (facts: readonly RollbackSessionFacts[]): Promise<string> => digest(facts);

/**
 * Older readers know neither `historyPrefix` nor native insertion-order prefixes, and 41debb3 validates
 * progress against pick-sorted history. Keep the progress only when both orders derive the saved cursor.
 */
export function toV1Session(session: PersistedDraftSession): { serialized: string; translation: RollbackExport['translations'][number] | null } {
  const { historyPrefix, ...progress } = session.draftProgress;
  const sorted = [...session.draftHistory].sort((a, b) => a.pickNumber - b.pickNumber);
  const prefix = new Set(sorted.slice(0, progress.historyLength).map(pick => pick.pickNumber));
  const prefixReadable = !historyPrefix || historyPrefix.length === prefix.size && historyPrefix.every(slot => prefix.has(slot));
  const readable = prefixReadable && deriveDraftCursor(sorted, progress) === session.currentPick && deriveDraftCursor(session.draftHistory, progress) === session.currentPick;
  const draftProgress: DraftProgress = readable ? progress : { anchor: { kind: 'carry', pickNumber: session.currentPick }, historyLength: session.draftHistory.length };
  const translation = readable ? null : {
    key: `${SESSION_PREFIX}${session.identity.provider}:${session.identity.draftId}`, from: session.draftProgress, to: draftProgress,
    reason: 'Older readers cannot derive this cursor from the progress prefix; exported as a carry anchor at the saved cursor',
  };
  const v1 = {
    version: 1, revision: session.revision, lineage: session.lineage, identity: session.identity, config: session.config,
    leagueSettings: session.leagueSettings, currentPick: session.currentPick, draftProgress, draftHistory: session.draftHistory,
    shortlistedPlayerIds: session.shortlistedPlayerIds, preloadedKeepers: session.preloadedKeepers, keepersInitialized: session.keepersInitialized,
    unresolvedProviderPicks: session.unresolvedProviderPicks, decisionLens: session.decisionLens,
    manualContinuityBaselineAt: session.manualContinuityBaselineAt, lastConfirmedSyncAt: session.lastConfirmedSyncAt,
    lastConfirmedPickNumber: session.lastConfirmedPickNumber,
  };
  return { serialized: JSON.stringify(v1), translation };
}

const exportBody = ({ digest: _digest, ...body }: RollbackExport): Omit<RollbackExport, 'digest'> => body;

async function assertExportDigest(value: RollbackExport): Promise<void> {
  if (await digest(exportBody(value)) !== value.digest) throw new Error('The rollback export does not match its digest');
}

function requireRecord(snapshot: DatabaseSnapshot): { record: ActivationRecord; serialized: string } {
  const { record, serialized } = activationRecordOf(snapshot);
  if (!record || serialized === null) throw new Error('No storage activation to roll back');
  return { record, serialized };
}

function activationFacts(current: unknown, prepared: unknown): unknown {
  return record(current) && current.state === 'rolled-back' && record(prepared)
    ? { ...current, state: prepared.state, rollback: prepared.rollback } : current;
}

function assertDatabaseUnchanged(snapshot: DatabaseSnapshot, value: RollbackExport): void {
  const rows = snapshot.sessions.map(({ key, session, serialized }) => ({ key, revision: session.revision, serialized }));
  if (JSON.stringify(rows) !== JSON.stringify(value.sessions) || JSON.stringify(snapshot.invalid) !== JSON.stringify(value.invalid)) {
    throw new Error('IndexedDB changed after the rollback export was prepared');
  }
  const preparedActivation = value.retained.find(row => row.key === ACTIVATION_RECORD)?.value;
  const retainedKeys = new Set(value.retained.map(row => row.key));
  const metadata = snapshot.metadata.filter(row => row.key !== ACTIVE_EXPORT &&
    (retainedKeys.has(row.key) || !row.key.startsWith(`${ROLLBACK_METADATA}:`))).map(({ key, value: current }) =>
    ({ key, value: key === ACTIVATION_RECORD ? activationFacts(current, preparedActivation) : current }));
  if (JSON.stringify(metadata) !== JSON.stringify(value.retained)) throw new Error('IndexedDB metadata changed after the rollback export was prepared');
}

function rawEntries(value: unknown): RawV1Entry[] {
  if (Array.isArray(value)) return value.flatMap(rawEntries);
  if (!record(value)) return [];
  if (typeof value.key === 'string' && typeof value.serialized === 'string' &&
    (value.key.startsWith(SESSION_PREFIX) || value.key.startsWith(JOURNAL_PREFIX))) return [{ key: value.key, serialized: value.serialized }];
  return Object.values(value).flatMap(rawEntries);
}

async function rollbackBlockers(snapshot: DatabaseSnapshot, source: readonly RawV1Entry[]): Promise<RollbackBlocker[]> {
  const entries = new Map<string, RawV1Entry>();
  const retained = snapshot.metadata.filter(row => row.key !== ACTIVE_EXPORT);
  for (const entry of [...rawEntries(retained), ...source]) entries.set(JSON.stringify(entry), entry);
  const fields: Omit<RollbackBlocker, 'id' | 'digest'>[] = [];
  for (const entry of entries.values()) {
    const incoming = importV1([entry]);
    const key = entry.key.slice(entry.key.startsWith(SESSION_PREFIX) ? SESSION_PREFIX.length : JOURNAL_PREFIX.length).split(':').slice(0, 2).join(':');
    const indexed = snapshot.sessions.find(row => row.key === key)?.session ?? null;
    const represented = entry.key.startsWith(SESSION_PREFIX) && incoming.sessions.length === 1 && !incoming.rejected.length &&
      !incoming.unresolved.length && indexed && JSON.stringify(rollbackFacts(incoming.sessions)) === JSON.stringify(rollbackFacts([indexed]));
    if (!represented) fields.push({ kind: 'retained-entry', entry, indexed, incoming, actions: ['keep-indexed'] });
  }
  for (const row of snapshot.invalid) fields.push({ kind: 'invalid-indexed', entry: { key: row.key, serialized: row.serialized }, indexed: null,
    incoming: { source: [], sessions: [], rejected: [{ key: row.key, serialized: row.serialized, path: '$', reason: row.reason }], unresolved: [] }, actions: ['keep-indexed'] });
  const blockers = await Promise.all(fields.map(async field => {
    const id = `${field.kind}:${await digest(field.entry)}`;
    return { ...field, id, digest: await digest(field) };
  }));
  return blockers.sort((a, b) => a.id.localeCompare(b.id));
}

function assertReconciled(value: RollbackExport): void {
  const { blockers, decisions, pending, stale } = value.reconciliation;
  if (pending.length || stale.length || blockers.some(blocker => !decisions.some(decision =>
    decision.blockerId === blocker.id && decision.digest === blocker.digest && decision.action === 'keep-indexed'))) throw new RollbackReconciliationError();
}

/** Fences every IndexedDB writer, then builds a deterministic export of every committed and retained fact. */
export async function prepareRollback(database: DraftDatabase, { storage, decisions = [] }: RollbackOptions = {}): Promise<RollbackExport> {
  const initial = await database.snapshot();
  const before = requireRecord(initial);
  if (before.record.state === 'rolled-back') throw new Error('Storage was already rolled back');
  if (before.record.state === 'imported') {
    await database.commit({ expect: { metadata: { [ACTIVATION_RECORD]: before.serialized } },
      metadata: [{ key: ACTIVATION_RECORD, value: { ...before.record, state: 'rolling-back', rollback: { startedAt: Date.now(), metadataKeys: initial.metadata.map(row => row.key) } } satisfies ActivationRecord }] });
  }
  const snapshot = await database.snapshot();
  const activation = requireRecord(snapshot).record;
  if (activation.state !== 'rolling-back') throw new Error('The rollback fence was not recorded');
  const source = storage ? snapshotV1Storage(storage) : [];
  const blockers = await rollbackBlockers(snapshot, source);
  const accepted = decisions.filter(decision => blockers.some(blocker => blocker.id === decision.blockerId && blocker.digest === decision.digest && decision.action === 'keep-indexed'));
  const reconciliation = { blockers, decisions: accepted,
    pending: blockers.filter(blocker => !accepted.some(decision => decision.blockerId === blocker.id)).map(blocker => blocker.id),
    stale: decisions.filter(decision => !accepted.includes(decision)).map(decision => decision.blockerId) };
  const converted = snapshot.sessions.map(row => ({ row, ...toV1Session(row.session) }));
  const writes = converted.map(({ row, serialized }) => ({ key: `${SESSION_PREFIX}${row.key}`, serialized })).sort((a, b) => a.key.localeCompare(b.key));
  const body: Omit<RollbackExport, 'digest'> = {
    version: 1, writes, reconciliation,
    clearKeys: source.filter(entry => !writes.some(write => write.key === entry.key)).map(entry => entry.key).sort(),
    expectedJournalsDigest: await digestRollbackJournals([]),
    clearJournalsFor: snapshot.sessions.map(row => row.key).sort(),
    sessions: snapshot.sessions.map(({ key, session, serialized }) => ({ key, revision: session.revision, serialized })),
    invalid: snapshot.invalid,
    retained: snapshot.metadata.filter(row => row.key !== ACTIVE_EXPORT).filter(row => activation.rollback?.metadataKeys?.includes(row.key) ?? !row.key.startsWith(`${ROLLBACK_METADATA}:`)).map(({ key, value }) => ({ key, value })),
    translations: converted.flatMap(row => row.translation ? [row.translation] : []),
    expectedFactsDigest: await digestRollbackFacts(rollbackFacts(writes.map(write => { const parsed: unknown = JSON.parse(write.serialized); return parsed; }))),
  };
  const value = { ...body, digest: await digest(body) };
  assertDatabaseUnchanged(snapshot, value);
  await database.commit({ expect: { metadata: { [ACTIVATION_RECORD]: requireRecord(snapshot).serialized } },
    metadata: [{ key: `${ROLLBACK_METADATA}:${value.digest}`, value }, { key: ACTIVE_EXPORT, value: value.digest },
      ...source.length ? [{ key: `${ROLLBACK_METADATA}:observed:${await digest(source)}`, value: source }] : []] });
  return value;
}

function validArray(value: unknown, valid: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(valid);
}
const validString = (value: unknown): boolean => typeof value === 'string';
const validRawEntry = (value: unknown): boolean => record(value) && validString(value.key) && validString(value.serialized);
function decodes(value: unknown, decode: (input: unknown) => unknown): boolean {
  try { decode(value); return true; } catch { return false; }
}
function validImport(value: unknown): boolean {
  return record(value) && validArray(value.source, validRawEntry) &&
    validArray(value.sessions, session => decodes(session, decodeIndexedSession)) &&
    validArray(value.rejected, row => validRawEntry(row) && record(row) && validString(row.path) && validString(row.reason)) &&
    validArray(value.unresolved, row => validRawEntry(row) && record(row) && decodes(row.change, decodeDraftSessionChange));
}
function isRollbackExport(value: unknown): value is RollbackExport {
  if (!record(value) || value.version !== 1 || !validString(value.digest) || !validString(value.expectedFactsDigest) ||
    !validString(value.expectedJournalsDigest) || !validArray(value.writes, validRawEntry) ||
    !validArray(value.clearKeys, validString) || !validArray(value.clearJournalsFor, validString) ||
    !validArray(value.sessions, row => validRawEntry(row) && record(row) && typeof row.revision === 'number' && Number.isSafeInteger(row.revision)) ||
    !validArray(value.invalid, row => validRawEntry(row) && record(row) && 'value' in row && validString(row.reason)) ||
    !validArray(value.retained, row => record(row) && validString(row.key) && 'value' in row) ||
    !validArray(value.translations, row => record(row) && validString(row.key) && validString(row.reason) &&
      decodes(row.from, decodeStoredDraftProgress) && decodes(row.to, decodeStoredDraftProgress)) || !record(value.reconciliation)) return false;
  const reconciliation = value.reconciliation;
  return validArray(reconciliation.pending, validString) && validArray(reconciliation.stale, validString) &&
    validArray(reconciliation.decisions, row => record(row) && validString(row.blockerId) && validString(row.digest) && row.action === 'keep-indexed') &&
    validArray(reconciliation.blockers, row => record(row) && validString(row.id) && validString(row.digest) &&
      (row.kind === 'retained-entry' || row.kind === 'invalid-indexed') && validRawEntry(row.entry) &&
      (row.indexed === null || decodes(row.indexed, decodeIndexedSession)) && validImport(row.incoming) &&
      Array.isArray(row.actions) && row.actions.length === 1 && row.actions[0] === 'keep-indexed');
}

/** Recover the exact saved payload, including pending decisions, after a crash or reload. */
export async function recoverRollbackExport(database: DraftDatabase): Promise<RollbackExport | null> {
  const snapshot = await database.snapshot();
  const active = snapshot.metadata.find(row => row.key === ACTIVE_EXPORT)?.value;
  if (active === undefined) return null;
  if (typeof active !== 'string') throw new Error('Invalid saved rollback export pointer');
  const saved = snapshot.metadata.find(row => row.key === `${ROLLBACK_METADATA}:${active}`)?.value;
  if (!isRollbackExport(saved) || saved.digest !== active) throw new Error('Invalid saved rollback export');
  await assertExportDigest(saved);
  const { record } = requireRecord(snapshot);
  if (record.state === 'imported' || record.state === 'rolled-back' && record.rollback?.exportDigest !== active) throw new Error('The saved rollback export is not the active rollback');
  const value = saved;
  assertDatabaseUnchanged(snapshot, value);
  return value;
}

/** Overwrites stale v1 keys with the export while the tombstone still freezes every v1 writer. Safe to repeat. */
export async function writeRollbackExport({ database, storage, export: value }: { database: DraftDatabase; storage: Storage; export: RollbackExport }): Promise<void> {
  await assertExportDigest(value);
  assertReconciled(value);
  const snapshot = await database.snapshot();
  const { record } = requireRecord(snapshot);
  if (record.state !== 'rolling-back') throw new Error('Prepare the rollback before writing its export');
  assertDatabaseUnchanged(snapshot, value);
  const tombstone = readTombstone(storage);
  if (tombstone !== 'present' && tombstone !== 'malformed') throw new Error('The storage tombstone must stay in place while the rollback export is written');
  const exportKey = `${ROLLBACK_METADATA}:${value.digest}`;
  const preKey = `${exportKey}:pre-export`;
  const source = snapshotV1Storage(storage);
  const currentBlockers = await rollbackBlockers(snapshot, source);
  if (currentBlockers.some(blocker => !value.reconciliation.decisions.some(decision => decision.blockerId === blocker.id && decision.digest === blocker.digest))) throw new RollbackReconciliationError();
  if (source.some(entry => !value.writes.some(write => write.key === entry.key) && !value.clearKeys.includes(entry.key))) throw new RollbackReconciliationError();
  const sourceKey = `${exportKey}:source:${await digest(source)}`;
  const metadata: { key: string; value: unknown }[] = [{ key: exportKey, value }, { key: sourceKey, value: source }];
  if (!snapshot.metadata.some(row => row.key === preKey)) metadata.push({ key: preKey, value: source });
  await database.commit({ expect: { metadata: { [ACTIVATION_RECORD]: JSON.stringify(record), [preKey]: snapshot.metadata.find(row => row.key === preKey)?.serialized ?? null } }, metadata });
  if (JSON.stringify(snapshotV1Storage(storage)) !== JSON.stringify(source)) throw new Error('v1 storage changed while retaining the rollback source; retry the export');
  if (!['present', 'malformed'].includes(readTombstone(storage))) throw new Error('The storage tombstone disappeared while retaining the rollback source');
  for (const { key, serialized } of value.writes) storage.setItem(key, serialized);
  for (const { key, serialized } of source) {
    if (!value.clearKeys.includes(key)) continue;
    if (storage.getItem(key) !== serialized) throw new Error(`A v1 journal changed before deletion: ${key}`);
    storage.removeItem(key);
  }
  assertStorageMatches(storage, value);
  await database.commit({ expect: { metadata: { [ACTIVATION_RECORD]: JSON.stringify(record) } },
    metadata: [{ key: `${exportKey}:written`, value: value.digest }] });
}

function assertStorageMatches(storage: Storage, value: RollbackExport): void {
  const mismatch = value.writes.find(({ key, serialized }) => storage.getItem(key) !== serialized);
  if (mismatch) throw new Error(`v1 storage does not hold the exported bytes for ${mismatch.key}`);
  const extra = snapshotV1Storage(storage).find(entry => !value.writes.some(write => write.key === entry.key));
  if (extra) throw new Error(`A v1 session or journal reappeared after the rollback export: ${extra.key}`);
}

function assertVerification(value: RollbackExport, verification: RollbackVerification, confirmation: RollbackConfirmation): void {
  if (!confirmed(confirmation.otherTabsClosed) || !confirmation.operator.trim()) throw new Error('The operator must confirm that every other draft tab and side panel is closed');
  if (verification.exportDigest !== value.digest) throw new Error('The verification evidence is for a different rollback export');
  if (!verification.verifiedBy.trim() || !Number.isFinite(verification.verifiedAt)) throw new Error('The verification evidence must name who ran it and when');
  for (const reader of ROLLBACK_READERS) {
    for (const phase of ['load', 'writeback'] as const) {
      const evidence = verification.readers.find(row => row.commit === reader.commit && row.phase === phase);
      if (!evidence || !/^[0-9a-f]{64}$/.test(evidence.moduleDigest)) throw new Error(`Missing ${phase} evidence from the ${reader.name} reader (${reader.commit})`);
      if (evidence.journalsDigest !== value.expectedJournalsDigest) throw new Error(`The ${reader.name} reader loaded different journals than the reconciled export`);
      if (evidence.factsDigest !== value.expectedFactsDigest) throw new Error(`The ${reader.name} reader ${phase === 'load' ? 'loaded' : 'wrote back'} different draft facts than the export`);
    }
  }
}

/** Records the rollback, keeping IndexedDB and the export, and only then removes the tombstone. Safe to repeat. */
export async function finalizeRollback({ database, storage, export: value, verification, confirmation }: {
  database: DraftDatabase; storage: Storage; export: RollbackExport; verification: RollbackVerification; confirmation: RollbackConfirmation;
}): Promise<void> {
  await assertExportDigest(value);
  assertReconciled(value);
  assertVerification(value, verification, confirmation);
  const snapshot = await database.snapshot();
  const { record, serialized } = requireRecord(snapshot);
  assertDatabaseUnchanged(snapshot, value);
  if (!snapshot.metadata.some(row => row.key === `${ROLLBACK_METADATA}:${value.digest}:written` && row.value === value.digest)) throw new Error('Write the rollback export before finalizing it');
  if (record.state === 'imported') throw new Error('Prepare the rollback before finalizing it');
  if (record.state === 'rolled-back' && record.rollback?.exportDigest !== value.digest) throw new Error('Storage was rolled back with a different export');
  assertStorageMatches(storage, value);
  const currentBlockers = await rollbackBlockers(snapshot, snapshotV1Storage(storage));
  if (currentBlockers.some(blocker => !value.reconciliation.decisions.some(decision => decision.blockerId === blocker.id && decision.digest === blocker.digest))) throw new RollbackReconciliationError();
  if (record.state === 'rolling-back') {
    const sessions = Object.fromEntries(value.sessions.map(row => [row.key, row.revision]));
    await database.commit({ expect: { metadata: { [ACTIVATION_RECORD]: serialized } }, metadata: [{ key: ACTIVATION_RECORD, value: {
      ...record, state: 'rolled-back',
      rollback: { ...record.rollback, exportDigest: value.digest, sessions, finalizedAt: Date.now(), verification, confirmation },
    } satisfies ActivationRecord }] });
  }
  assertStorageMatches(storage, value);
  storage.removeItem(DRAFT_STORAGE_MIGRATION_KEY);
  if (storage.getItem(DRAFT_STORAGE_MIGRATION_KEY) !== null) throw new Error('The storage tombstone could not be removed');
}
