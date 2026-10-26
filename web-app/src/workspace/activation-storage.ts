import { DRAFT_STORAGE_MIGRATION_KEY, isDraftSessionIdentity, isDraftStorageMigration, type DraftStorageMigration } from '@fantasy-draft/shared/sync';
import type { DraftSessionIdentity, PersistedDraftSession } from '@/stores/draftSessionStorage';
import type { DraftSessionChange } from '@/stores/draftSessionUnconfirmedSaves';
import { decodeIndexedSession } from './idb-session';
import { V1SourceChangedError } from './import-snapshot';
import {
  ACTIVATION_RECORD, DatabaseConflictError, IMPORT_METADATA, digest, importSourceDigest, openDraftDatabase, sessionKey,
  type DatabaseSnapshot, type DraftDatabase, type StorageDiagnostic,
} from './indexed-db';
import { importV1, snapshotV1Storage, type RawV1Entry, type V1Import } from './v1-import';

const SESSION_PREFIX = 'fantasy-draft-session-v1:';
const JOURNAL_PREFIX = 'fantasy-draft-session-unconfirmed-v1:';
const REFUSAL_PREFIX = `${IMPORT_METADATA}:refused:`;
export const ACTIVATION_WRITER = 'web-app:idb-activation';

const confirmed = (value: unknown): boolean => value === true;
export type ActivationAction = 'keep-imported' | 'discard-entry';
export type ActivationBlockerKind = 'unresolved-journal' | 'invalid-record' | 'rejected-values' | 'changed-source' | 'prior-refusal' | 'invalid-indexed';
export type TombstoneState = 'absent' | 'present' | 'malformed' | 'unreadable';
interface PickFact { readonly pickNumber: number; readonly playerId: string; readonly source: string }

export interface SessionComparison {
  readonly cursor: { readonly indexed: number; readonly incoming: number | null };
  readonly picksOnlyIndexed: readonly PickFact[];
  readonly picksOnlyIncoming: readonly PickFact[];
  readonly queue: { readonly indexed: readonly string[]; readonly incoming: readonly string[] };
}

/** One item the user must decide after seeing its raw bytes and, where present, the committed IndexedDB facts. */
export interface ActivationBlocker {
  readonly id: string;
  readonly kind: ActivationBlockerKind;
  readonly identity: DraftSessionIdentity | null;
  readonly entries: readonly RawV1Entry[];
  readonly reasons: readonly string[];
  readonly indexed: PersistedDraftSession | null;
  readonly incoming: PersistedDraftSession | null;
  readonly comparison: SessionComparison | null;
  readonly actions: readonly ActivationAction[];
  /** Covers the raw bytes and committed facts shown; a decision for another digest is stale. */
  readonly digest: string;
}

export interface ActivationDecision { readonly blockerId: string; readonly digest: string; readonly action: ActivationAction }
export interface ActivationConfirmation { readonly otherTabsClosed: true }
interface RetainedDecision { readonly decision: ActivationDecision; readonly blocker: ActivationBlocker }

export interface ActivationRecord {
  readonly version: 1;
  readonly state: 'imported' | 'rolling-back' | 'rolled-back';
  readonly activatedAt: number;
  /** The exact raw v1 source the import used. */
  readonly source: readonly RawV1Entry[];
  readonly sourceDigest: string;
  /** The latest raw source accepted, by the import or by acknowledging late v1 changes. */
  readonly acceptedSourceDigest: string;
  readonly decisions: readonly RetainedDecision[];
  /** Revision of every session key the activation imported or kept. */
  readonly sessions: Readonly<Record<string, number>>;
  readonly late: readonly { readonly at: number; readonly source: readonly RawV1Entry[]; readonly sourceDigest: string; readonly decisions: readonly RetainedDecision[] }[];
  /** Set by the rollback flow; see rollback-export.ts. */
  readonly rollback?: { readonly startedAt?: number; readonly metadataKeys?: readonly string[]; readonly exportDigest?: string; readonly sessions?: Readonly<Record<string, number>>; readonly [detail: string]: unknown };
}

export type ActivationReview =
  | { readonly status: 'unavailable'; readonly reason: 'blocked' | 'quota' | 'unavailable' | 'timeout' | 'probe-mismatch' | 'source-unreadable'; readonly message: string; readonly error: unknown }
  | { readonly status: 'rollback-in-progress'; readonly message: string }
  | {
    readonly status: 'review';
    /** fresh: nothing committed. resume: committed, tombstone missing or late v1 changes. complete: committed and tombstoned. */
    readonly phase: 'fresh' | 'resume' | 'complete';
    readonly ready: boolean;
    readonly source: readonly RawV1Entry[];
    readonly sourceDigest: string;
    /** Sessions activation will write under the decisions passed to `preflight`. */
    readonly sessions: readonly PersistedDraftSession[];
    readonly unchanged: readonly string[];
    readonly rejected: V1Import['rejected'];
    readonly unresolved: readonly { readonly key: string; readonly serialized: string; readonly change: DraftSessionChange }[];
    readonly indexed: {
      readonly sessions: readonly PersistedDraftSession[];
      readonly invalid: DatabaseSnapshot['invalid'];
      readonly refusals: readonly { readonly key: string; readonly value: unknown }[];
      readonly activation: ActivationRecord | null;
    };
    readonly blockers: readonly ActivationBlocker[];
    /** Blocker ids without a matching decision. */
    readonly pending: readonly string[];
    /** Decision blocker ids that match no displayed blocker, digest or allowed action. */
    readonly stale: readonly string[];
    readonly tombstone: TombstoneState;
    readonly digest: string;
  };
type Review = Extract<ActivationReview, { status: 'review' }>;

export class ActivationStaleError extends Error {
  constructor(readonly review: ActivationReview) { super('Draft data changed or needs a decision. Review it again before activating.'); this.name = 'ActivationStaleError'; }
}
export class ActivationUnavailableError extends Error {
  constructor(readonly review: Extract<ActivationReview, { status: 'unavailable' | 'rollback-in-progress' }>) { super(review.message); this.name = 'ActivationUnavailableError'; }
}
class ActivationTimeoutError extends Error {
  constructor(timeoutMs: number) { super(`IndexedDB did not respond within ${timeoutMs} ms`); this.name = 'ActivationTimeoutError'; }
}
export class ActivationCancelledError extends Error {
  constructor() { super('Storage activation was cancelled.'); this.name = 'ActivationCancelledError'; }
}

export interface ActivationController {
  preflight(decisions?: readonly ActivationDecision[]): Promise<ActivationReview>;
  activate(decisions: readonly ActivationDecision[], confirmation: ActivationConfirmation): Promise<DraftDatabase>;
  resume(): Promise<DraftDatabase | null>;
  cancel(): void;
  close(): void;
}

export function isActivationRecord(value: unknown): value is ActivationRecord {
  return typeof value === 'object' && value !== null && 'version' in value && value.version === 1 &&
    'state' in value && (value.state === 'imported' || value.state === 'rolling-back' || value.state === 'rolled-back') &&
    'source' in value && Array.isArray(value.source) && 'acceptedSourceDigest' in value && typeof value.acceptedSourceDigest === 'string' &&
    'sessions' in value && typeof value.sessions === 'object' && value.sessions !== null;
}

export function activationRecordOf(snapshot: DatabaseSnapshot): { record: ActivationRecord | null; serialized: string | null } {
  const row = snapshot.metadata.find(entry => entry.key === ACTIVATION_RECORD);
  if (!row) return { record: null, serialized: null };
  if (!isActivationRecord(row.value)) throw new Error('Invalid storage activation record');
  return { record: row.value, serialized: row.serialized };
}

export function readTombstone(storage: Pick<Storage, 'getItem'>): TombstoneState {
  let serialized: string | null;
  try { serialized = storage.getItem(DRAFT_STORAGE_MIGRATION_KEY); } catch { return 'unreadable'; }
  if (serialized === null) return 'absent';
  try { const value: unknown = JSON.parse(serialized); return isDraftStorageMigration(value) ? 'present' : 'malformed'; } catch { return 'malformed'; }
}

export const sourceDigestOf = (source: readonly RawV1Entry[]): Promise<string> =>
  digest([...source].sort((a, b) => a.key.localeCompare(b.key)));

function groupOf(key: string): { group: string; identity: DraftSessionIdentity | null } {
  const body = key.startsWith(SESSION_PREFIX) ? key.slice(SESSION_PREFIX.length) : key.startsWith(JOURNAL_PREFIX) ? key.slice(JOURNAL_PREFIX.length) : null;
  const [provider, draftId] = body?.split(':') ?? [];
  const identity: unknown = { provider, draftId };
  return isDraftSessionIdentity(identity) && draftId ? { group: sessionKey(identity), identity } : { group: key, identity: null };
}

function compare(indexed: PersistedDraftSession, incoming: PersistedDraftSession | null): SessionComparison {
  const facts = (session: PersistedDraftSession | null): PickFact[] =>
    session?.draftHistory.map(({ pickNumber, playerId, source }) => ({ pickNumber, playerId, source })) ?? [];
  const only = (left: PickFact[], right: PickFact[]): PickFact[] =>
    left.filter(pick => !right.some(other => other.pickNumber === pick.pickNumber && other.playerId === pick.playerId && other.source === pick.source));
  return {
    cursor: { indexed: indexed.currentPick, incoming: incoming?.currentPick ?? null },
    picksOnlyIndexed: only(facts(indexed), facts(incoming)), picksOnlyIncoming: only(facts(incoming), facts(indexed)),
    queue: { indexed: indexed.shortlistedPlayerIds, incoming: incoming?.shortlistedPlayerIds ?? [] },
  };
}

interface Plan {
  readonly review: Review;
  readonly writes: readonly { readonly key: string; readonly session: PersistedDraftSession; readonly sourceDigest: string }[];
  readonly kept: readonly string[];
  readonly record: ActivationRecord | null;
  readonly recordSerialized: string | null;
  readonly snapshot: DatabaseSnapshot;
  readonly accepted: readonly RetainedDecision[];
}

async function blocker(fields: Omit<ActivationBlocker, 'digest' | 'indexed' | 'incoming' | 'comparison'> & Partial<Pick<ActivationBlocker, 'indexed' | 'incoming' | 'comparison'>>, context: unknown = null): Promise<ActivationBlocker> {
  const { id, kind, entries, reasons } = fields;
  return { indexed: null, incoming: null, comparison: null, ...fields, digest: await digest({ id, kind, entries, reasons, context }) };
}

async function plan({ source, snapshot, decisions, tombstone }: {
  source: readonly RawV1Entry[]; snapshot: DatabaseSnapshot; decisions: readonly ActivationDecision[]; tombstone: TombstoneState;
}): Promise<Plan> {
  const { record, serialized: recordSerialized } = activationRecordOf(snapshot);
  const sourceDigest = await sourceDigestOf(source);
  const indexed = new Map(snapshot.sessions.map(row => [row.key, row]));
  const meta = new Map(snapshot.metadata.map(row => [row.key, row]));
  const full = importV1(source);
  const blockers = new Map<string, ActivationBlocker>();
  const add = async (value: ActivationBlocker): Promise<void> => {
    if (blockers.has(value.id)) return;
    const key = value.identity ? sessionKey(value.identity) : null;
    const incoming = value.incoming ?? full.sessions.find(session => sessionKey(session.identity) === key) ?? null;
    const saved = value.indexed ?? (key ? indexed.get(key)?.session ?? null : null);
    const enriched = { ...value, incoming, indexed: saved, comparison: value.comparison ?? (saved ? compare(saved, incoming) : null) };
    blockers.set(value.id, { ...enriched, digest: await digest(enriched) });
  };
  const decided = new Map(decisions.map(decision => [decision.blockerId, decision]));
  const writes: Plan['writes'][number][] = [];
  const kept: string[] = [];
  const unchanged: string[] = [];
  let phase: Review['phase'] = 'fresh';
  let imported = full;

  if (record?.state === 'imported') {
    phase = record.acceptedSourceDigest === sourceDigest && tombstone === 'present' ? 'complete' : 'resume';
    if (record.acceptedSourceDigest !== sourceDigest) {
      const previous = record.late.at(-1)?.source ?? record.source;
      const groups = new Map<string, { identity: DraftSessionIdentity | null; keys: Set<string> }>();
      const before = new Map(previous.map(entry => [entry.key, entry.serialized]));
      const after = new Map(source.map(entry => [entry.key, entry.serialized]));
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(key) === after.get(key)) continue;
        const { group, identity } = groupOf(key);
        const row = groups.get(group) ?? { identity, keys: new Set<string>() };
        row.keys.add(key); groups.set(group, row);
      }
      for (const [group, { identity }] of groups) {
        const entries = source.filter(entry => groupOf(entry.key).group === group);
        const was = previous.filter(entry => groupOf(entry.key).group === group);
        const current = indexed.get(group);
        const incoming = full.sessions.find(session => sessionKey(session.identity) === group) ?? null;
        await add(await blocker({ id: `changed-source:${group}`, kind: 'changed-source', identity, entries,
          reasons: [`v1 bytes changed after the IndexedDB import was acknowledged (previously ${was.length} entries, now ${entries.length})`],
          indexed: current?.session ?? null, incoming, comparison: current ? compare(current.session, incoming) : null,
          actions: ['keep-imported'] }, current?.serialized ?? null));
      }
    }
  } else {
    const originalImportContext = (key: string): unknown => {
      const group = groupOf(key).group;
      return {
        source: source.filter(entry => groupOf(entry.key).group === group),
        incoming: full.sessions.find(session => sessionKey(session.identity) === group) ?? null,
        indexed: indexed.get(group)?.serialized ?? snapshot.invalid.find(row => row.key === group)?.serialized ?? null,
      };
    };
    const entryBlockers = async (result: V1Import): Promise<void> => {
      const rejected = new Map<string, V1Import['rejected']>();
      for (const row of result.rejected) rejected.set(row.key, [...rejected.get(row.key) ?? [], row]);
      for (const [key, rows] of rejected) {
        const invalid = rows.some(row => row.path === '$');
        const kind = invalid ? 'invalid-record' : 'rejected-values';
        await add(await blocker({ id: `${kind}:${key}`, kind, identity: groupOf(key).identity,
          entries: [{ key, serialized: rows[0]?.serialized ?? '' }], reasons: rows.map(row => `${row.path}: ${row.reason}`),
          actions: invalid ? ['discard-entry'] : ['keep-imported', 'discard-entry'] }, originalImportContext(key)));
      }
      for (const row of result.unresolved) {
        await add(await blocker({ id: `unresolved-journal:${row.key}`, kind: 'unresolved-journal', identity: groupOf(row.key).identity,
          entries: [{ key: row.key, serialized: row.serialized }], reasons: ['The journal does not apply to the saved head; its changes may be unsaved picks or queue edits'],
          actions: ['keep-imported', 'discard-entry'] }, originalImportContext(row.key)));
      }
    };
    await entryBlockers(full);
    const discarded = new Set([...blockers.values()].flatMap(item => {
      const decision = decided.get(item.id);
      return decision?.action === 'discard-entry' && decision.digest === item.digest ? item.entries.map(entry => entry.key) : [];
    }));
    imported = discarded.size ? importV1(source.filter(entry => !discarded.has(entry.key))) : full;
    await entryBlockers(imported);
    const exported = record?.state === 'rolled-back' ? record.rollback?.sessions ?? {} : {};
    for (const session of imported.sessions) {
      const key = sessionKey(session.identity);
      const digestValue = await importSourceDigest(imported.source, session);
      const current = indexed.get(key);
      const invalid = snapshot.invalid.find(row => row.key === key);
      const marker: unknown = meta.get(`${IMPORT_METADATA}:${key}`)?.value;
      const markerField = (name: string): unknown => typeof marker === 'object' && marker !== null ? Reflect.get(marker, name) : undefined;
      if (invalid) kept.push(key);
      else if (!current) writes.push({ key, session, sourceDigest: digestValue });
      else if (markerField('sourceDigest') === digestValue) unchanged.push(key);
      else if (markerField('importedRevision') === current.session.revision || exported[key] === current.session.revision) writes.push({ key, session, sourceDigest: digestValue });
      else {
        kept.push(key);
        await add(await blocker({ id: `changed-source:${key}`, kind: 'changed-source', identity: session.identity,
          entries: source.filter(entry => groupOf(entry.key).group === key),
          reasons: ['IndexedDB holds acknowledged changes this v1 source does not contain'],
          indexed: current.session, incoming: session, comparison: compare(current.session, session), actions: ['keep-imported'] }, current.serialized));
      }
    }
    for (const row of snapshot.invalid) {
      const identity = groupOf(`${SESSION_PREFIX}${row.key}`).identity;
      await add(await blocker({ id: `invalid-indexed:${row.key}`, kind: 'invalid-indexed', identity,
        entries: source.filter(entry => groupOf(entry.key).group === row.key), reasons: [row.reason],
        actions: ['keep-imported'] }, row.serialized));
    }
    for (const row of snapshot.metadata) {
      if (!row.key.startsWith(REFUSAL_PREFIX) || typeof row.value !== 'object' || row.value === null || 'acknowledged' in row.value) continue;
      const identity: unknown = Reflect.get(row.value, 'identity');
      const refusedSource: unknown = Reflect.get(row.value, 'source');
      await add(await blocker({ id: `prior-refusal:${row.key}`, kind: 'prior-refusal', identity: isDraftSessionIdentity(identity) ? identity : null,
        entries: Array.isArray(refusedSource) ? refusedSource.filter((entry: unknown): entry is RawV1Entry => typeof entry === 'object' && entry !== null && 'key' in entry && typeof entry.key === 'string' && 'serialized' in entry && typeof entry.serialized === 'string') : [],
        reasons: [String(Reflect.get(row.value, 'reason') ?? 'Refused v1 source')],
        indexed: isDraftSessionIdentity(identity) ? indexed.get(sessionKey(identity))?.session ?? null : null,
        actions: ['keep-imported'] }, row.serialized));
    }
  }

  const list = [...blockers.values()];
  const accepted = list.flatMap(item => {
    const decision = decided.get(item.id);
    return decision && decision.digest === item.digest && item.actions.includes(decision.action) ? [{ decision, blocker: item }] : [];
  });
  const stale = decisions.filter(decision => !accepted.some(row => row.decision === decision)).map(decision => decision.blockerId);
  const pending = list.filter(item => !accepted.some(row => row.blocker.id === item.id)).map(item => item.id);
  const review: Review = {
    status: 'review', phase, ready: !pending.length && !stale.length, source, sourceDigest,
    sessions: writes.map(row => row.session), unchanged, rejected: full.rejected, unresolved: full.unresolved,
    indexed: { sessions: snapshot.sessions.map(row => row.session), invalid: snapshot.invalid,
      refusals: snapshot.metadata.filter(row => row.key.startsWith(REFUSAL_PREFIX)).map(({ key, value }) => ({ key, value })), activation: record },
    blockers: list, pending, stale, tombstone,
    digest: await digest({ sourceDigest, snapshot: [snapshot.sessions.map(row => [row.key, row.serialized]), snapshot.invalid.map(row => [row.key, row.serialized]), snapshot.metadata.map(row => [row.key, row.serialized])], blockers: list.map(item => item.digest), decisions: accepted.map(row => row.decision) }),
  };
  return { review, writes, kept, record, recordSerialized, snapshot, accepted };
}

function classify(error: unknown, diagnostics: readonly StorageDiagnostic[]): Extract<ActivationReview, { status: 'unavailable' }> {
  if (error instanceof ActivationTimeoutError) return { status: 'unavailable', reason: 'timeout', error, message: 'Durable draft storage did not respond. Close other draft tabs and side panels, then retry. Your drafts stay in the current storage.' };
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (diagnostics.some(row => row.phase === 'blocked')) return { status: 'unavailable', reason: 'blocked', error, message: 'Close other draft tabs and side panels, then retry. Your drafts stay in the current storage.' };
  if (name === 'QuotaExceededError' || diagnostics.some(row => row.error instanceof DOMException && row.error.name === 'QuotaExceededError')) {
    return { status: 'unavailable', reason: 'quota', error, message: 'The browser has no storage space left for drafts. Free space, then retry. Your drafts stay in the current storage.' };
  }
  return { status: 'unavailable', reason: 'unavailable', error, message: 'This browser cannot open durable draft storage (private browsing or storage disabled). Your drafts stay in the current storage.' };
}

export function createActivationStorage({ storage, factory, report, now = Date.now, name, timeoutMs = 10_000 }: {
  storage: Storage;
  factory: IDBFactory;
  report: (diagnostic: StorageDiagnostic) => void;
  now?: () => number;
  name?: string;
  /** Bound on opening and probing IndexedDB; some private modes never settle an open request. */
  timeoutMs?: number;
}): ActivationController {
  let database: DraftDatabase | undefined;
  let handedOut = false;
  let opening: Promise<DraftDatabase> | undefined;
  let openEpoch = 0;
  let cancelled = false;
  let reviewed: { sourceDigest: string; snapshot: string } | undefined;
  const diagnostics: StorageDiagnostic[] = [];
  const track = (diagnostic: StorageDiagnostic): void => { diagnostics.push(diagnostic); report(diagnostic); };

  async function open(): Promise<DraftDatabase> {
    if (database) return database;
    if (!opening) {
      const epoch = openEpoch;
      const attempt = openDraftDatabase({ factory, decode: decodeIndexedSession, report: track, ...name ? { name } : {} });
      opening = within(attempt).then(db => {
        if (epoch !== openEpoch) { db.close(); throw new ActivationCancelledError(); }
        database = db;
        return db;
      }, (error: unknown) => {
        // A timed-out request can still open later. It must not resurrect a controller handle.
        void attempt.then(db => { db.close(); }, () => undefined);
        throw error;
      }).finally(() => { opening = undefined; });
    }
    return opening;
  }

  function within<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new ActivationTimeoutError(timeoutMs)); }, timeoutMs);
    });
    return Promise.race([work, timeout]).finally(() => { clearTimeout(timer); });
  }

  async function probe(): Promise<Extract<ActivationReview, { status: 'unavailable' }> | null> {
    diagnostics.length = 0;
    let db: DraftDatabase | undefined;
    const key = `activation-probe:${now()}:${Math.random().toString(36).slice(2)}`;
    try {
      db = await within(open());
      const value = `probe:${Math.random().toString(36).slice(2)}`;
      const written = await within(db.probe(key, value));
      const read = await within(db.probe(key));
      const removed = await within(db.probe(key, null));
      if (written !== value || read !== value || removed !== null) {
        return { status: 'unavailable', reason: 'probe-mismatch', error: new Error('Storage probe returned different data'), message: 'Durable draft storage did not return what it stored. Your drafts stay in the current storage.' };
      }
      return null;
    } catch (error) {
      return classify(error, diagnostics);
    } finally {
      if (db) await within(db.probe(key, null)).catch(() => undefined);
    }
  }

  const snapshotKey = (snapshot: DatabaseSnapshot): string => JSON.stringify([snapshot.sessions.map(row => [row.key, row.serialized]), snapshot.invalid.map(row => [row.key, row.serialized]), snapshot.metadata.map(row => [row.key, row.serialized])]);

  async function review(decisions: readonly ActivationDecision[]): Promise<{ review: ActivationReview; plan?: Plan }> {
    const unavailable = await probe();
    if (unavailable) return { review: unavailable };
    let source: RawV1Entry[];
    try { source = snapshotV1Storage(storage); }
    catch (error) { return { review: { status: 'unavailable', reason: 'source-unreadable', error, message: 'Draft data changed while it was being read. Close other draft tabs, then retry.' } }; }
    const db = await open();
    let snapshot: DatabaseSnapshot;
    try { snapshot = await within(db.snapshot()); }
    catch (error) { return { review: classify(error, diagnostics) }; }
    const { record } = activationRecordOf(snapshot);
    if (record?.state === 'rolling-back') return { review: { status: 'rollback-in-progress', message: 'An operator rollback is in progress. Drafts stay read-only until it finishes.' } };
    const result = await plan({ source, snapshot, decisions, tombstone: readTombstone(storage) });
    return { review: result.review, plan: result };
  }

  function writeTombstone(record: ActivationRecord, verifySource: () => void): void {
    verifySource();
    if (readTombstone(storage) !== 'present') {
      const value: DraftStorageMigration = { version: 1, migratedAt: now(), by: ACTIVATION_WRITER };
      storage.setItem(DRAFT_STORAGE_MIGRATION_KEY, JSON.stringify(value));
    }
    if (readTombstone(storage) !== 'present') throw new Error(`Storage tombstone was not written after importing ${record.sourceDigest}`);
  }

  return {
    async preflight(decisions = []) {
      const result = await review(decisions);
      if (result.review.status === 'review' && result.plan) reviewed = { sourceDigest: result.review.sourceDigest, snapshot: snapshotKey(result.plan.snapshot) };
      return result.review;
    },

    async activate(decisions, confirmation) {
      if (!confirmed(confirmation.otherTabsClosed)) throw new Error('Confirm that other draft tabs and side panels are closed before activating.');
      if (cancelled) throw new ActivationCancelledError();
      if (!reviewed) throw new Error('Show the activation review before activating.');
      const { review: current, plan: result } = await review(decisions);
      if (current.status !== 'review' || !result) throw new ActivationUnavailableError(current as Extract<ActivationReview, { status: 'unavailable' | 'rollback-in-progress' }>);
      if (!current.ready || current.sourceDigest !== reviewed.sourceDigest || snapshotKey(result.snapshot) !== reviewed.snapshot) throw new ActivationStaleError(current);
      if (cancelled) throw new ActivationCancelledError();
      const db = await open();
      const captured = new Map(current.source.map(entry => [entry.key, entry.serialized]));
      const verifySource = (): void => {
        const latest = snapshotV1Storage(storage);
        if (latest.length !== captured.size || latest.some(entry => captured.get(entry.key) !== entry.serialized)) throw new V1SourceChangedError(current.source, latest);
      };
      const at = now();
      const refusals = result.accepted.filter(row => row.blocker.kind === 'changed-source').map(row => ({
        key: `${REFUSAL_PREFIX}${row.blocker.id.slice('changed-source:'.length)}:${row.blocker.digest}`,
        value: { identity: row.blocker.identity, reason: row.blocker.reasons.join('; '), source: row.blocker.entries, sourceDigest: row.blocker.digest, acknowledged: { at, blockerId: row.blocker.id } },
      }));
      const acknowledged = result.accepted.filter(row => row.blocker.kind === 'prior-refusal').flatMap(row => {
        const key = row.blocker.id.slice('prior-refusal:'.length);
        const value: unknown = result.snapshot.metadata.find(entry => entry.key === key)?.value;
        return typeof value === 'object' && value !== null ? [{ key, value: { ...value, acknowledged: { at, blockerId: row.blocker.id } } }] : [];
      });
      let record: ActivationRecord;
      const metadata: { key: string; value: unknown }[] = [...refusals, ...acknowledged];
      const expectSessions: Record<string, string | null> = {};
      const expectMetadata: Record<string, string | null> = { [ACTIVATION_RECORD]: result.recordSerialized };
      const serializedOf = (key: string): string | null => result.snapshot.metadata.find(row => row.key === key)?.serialized ?? null;
      for (const { key } of metadata) expectMetadata[key] = serializedOf(key);
      if (result.record?.state === 'imported') {
        record = current.sourceDigest === result.record.acceptedSourceDigest ? result.record : {
          ...result.record, acceptedSourceDigest: current.sourceDigest,
          late: [...result.record.late, { at, source: current.source, sourceDigest: current.sourceDigest, decisions: result.accepted }],
        };
      } else {
        const sessions: Record<string, number> = {};
        for (const row of result.writes) sessions[row.key] = row.session.revision;
        for (const key of [...current.unchanged, ...result.kept]) {
          const revision = result.snapshot.sessions.find(row => row.key === key)?.session.revision;
          if (revision !== undefined) sessions[key] = revision;
        }
        for (const key of [...result.writes.map(row => row.key), ...result.kept]) {
          expectSessions[key] = result.snapshot.sessions.find(row => row.key === key)?.serialized ?? result.snapshot.invalid.find(row => row.key === key)?.serialized ?? null;
        }
        record = { version: 1, state: 'imported', activatedAt: at, source: current.source, sourceDigest: current.sourceDigest,
          acceptedSourceDigest: current.sourceDigest, decisions: result.accepted, sessions, late: [] };
        if (result.record) metadata.push({ key: `${ACTIVATION_RECORD}:history:${result.record.activatedAt}:${result.record.sourceDigest}`, value: result.record });
        for (const row of result.writes) {
          const key = `${IMPORT_METADATA}:${row.key}`;
          expectMetadata[key] = serializedOf(key);
          metadata.push({ key, value: { identity: row.session.identity, importedRevision: row.session.revision, sourceDigest: row.sourceDigest, complete: true, activation: current.sourceDigest } });
        }
      }
      if (record !== result.record) metadata.push({ key: ACTIVATION_RECORD, value: record });
      try {
        await db.commit({ expect: { snapshot: result.snapshot, sessions: expectSessions, metadata: expectMetadata }, sessions: result.writes, metadata, verify: verifySource });
      } catch (error) {
        if (error instanceof DatabaseConflictError || error instanceof V1SourceChangedError) throw new ActivationStaleError((await review(decisions)).review);
        throw error;
      }
      if (cancelled) throw new ActivationCancelledError();
      try { writeTombstone(record, verifySource); }
      catch (error) {
        if (error instanceof V1SourceChangedError) throw new ActivationStaleError((await review([])).review);
        throw error;
      }
      handedOut = true;
      return db;
    },

    async resume() {
      if (cancelled) return null;
      try {
        const db = await open();
        const { record } = activationRecordOf(await within(db.snapshot()));
        if (record?.state !== 'imported' || readTombstone(storage) !== 'present') return null;
        if (await within(sourceDigestOf(snapshotV1Storage(storage))) !== record.acceptedSourceDigest) return null;
        handedOut = true;
        return db;
      } catch { return null; }
    },

    cancel() { cancelled = true; },
    close() { openEpoch += 1; if (!handedOut) database?.close(); database = undefined; },
  };
}
