import { assertDraftStorageWritable, DraftStorageMigratedError } from './draftStorageMigration';
import { decodeDraftSessionChange } from '@fantasy-draft/shared/catalog';
import type { RecordedDraftPick } from './draft/types';
import {
  joinStorageKey,
  type DraftSessionIdentity,
  type DraftSessionStorage,
  type PersistedDraftSession,
} from './draftSessionStorage';

/**
 * Session fields merged as whole values. A change applies only where the stored
 * session still holds the value the writing tab started from.
 */
const MERGED_FIELDS = [
  'config',
  'leagueSettings',
  'preloadedKeepers',
  'keepersInitialized',
  'unresolvedProviderPicks',
  'decisionLens',
  'manualContinuityBaselineAt',
  'lastConfirmedSyncAt',
  'lastConfirmedPickNumber',
  'currentPick',
] as const satisfies readonly (keyof PersistedDraftSession)[];

type MergedField = (typeof MERGED_FIELDS)[number];

type FieldChanges = {
  readonly [Field in MergedField]?: {
    readonly before: PersistedDraftSession[Field];
    readonly after: PersistedDraftSession[Field];
  };
};

interface DraftPickChange {
  readonly pickNumber: number;
  readonly before: RecordedDraftPick | null;
  readonly after: RecordedDraftPick | null;
}

/**
 * What one save changed, stored as data so any tab can merge it back after a
 * concurrent save overwrote it, even once the writing tab has reloaded.
 */
export interface DraftSessionChange {
  readonly writeId: string;
  /** Newest write in the session this save built on; null for a first save. */
  readonly baseWriteId: string | null;
  /** Revision of the session this save wrote. */
  readonly revision: number;
  readonly picks: readonly DraftPickChange[];
  readonly queueAdded: readonly string[];
  readonly queueRemoved: readonly string[];
  readonly fields: FieldChanges;
}

/** A saved change read back from storage, with the text needed to remove it safely. */
export interface StoredDraftSessionChange {
  readonly key: string;
  readonly serialized: string;
  readonly change: DraftSessionChange;
}

const UNCONFIRMED_SAVE_KEY = 'fantasy-draft-session-unconfirmed-v1';

function getUnconfirmedSaveKeyPrefix(identity: DraftSessionIdentity): string {
  return `${joinStorageKey(UNCONFIRMED_SAVE_KEY, identity.provider, identity.draftId)}:`;
}

/** Each tab keeps its latest save under its own key, which no other tab writes. */
function getUnconfirmedSaveKey(identity: DraftSessionIdentity, tabId: string): string {
  return joinStorageKey(UNCONFIRMED_SAVE_KEY, identity.provider, identity.draftId, tabId);
}

/** Deep equality for JSON data; key order and undefined properties are ignored. */
function isSameSessionValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  return leftEntries.length === Object.values(right).filter((value) => value !== undefined).length &&
    leftEntries.every(([key, value]) => Object.hasOwn(right, key) && isSameSessionValue(value, Reflect.get(right, key)));
}

/** Describes how `next` differs from the session it was built on. */
export function computeDraftSessionChange(
  base: PersistedDraftSession | null,
  next: PersistedDraftSession,
  writeId: string
): DraftSessionChange {
  const beforePicks = new Map((base?.draftHistory ?? []).map((pick) => [pick.pickNumber, pick]));
  const afterPicks = new Map(next.draftHistory.map((pick) => [pick.pickNumber, pick]));
  const picks: DraftPickChange[] = [];
  for (const pickNumber of new Set([...beforePicks.keys(), ...afterPicks.keys()])) {
    const before = beforePicks.get(pickNumber) ?? null;
    const after = afterPicks.get(pickNumber) ?? null;
    if (!isSameSessionValue(before, after)) picks.push({ pickNumber, before, after });
  }

  const beforeQueue = new Set(base?.shortlistedPlayerIds ?? []);
  const afterQueue = new Set(next.shortlistedPlayerIds);
  const fields: Record<string, { before: unknown; after: unknown }> = {};
  // Without a base there is no earlier value to compare against, so no field can merge.
  if (base) {
    for (const field of MERGED_FIELDS) {
      if (!isSameSessionValue(base[field], next[field])) fields[field] = { before: base[field], after: next[field] };
    }
  }
  return {
    writeId,
    baseWriteId: base?.lineage.at(-1) ?? null,
    revision: next.revision,
    picks,
    queueAdded: next.shortlistedPlayerIds.filter((playerId) => !beforeQueue.has(playerId)),
    queueRemoved: [...beforeQueue].filter((playerId) => !afterQueue.has(playerId)),
    fields: fields as FieldChanges,
  };
}

export function isEmptyDraftSessionChange(change: DraftSessionChange): boolean {
  return change.picks.length === 0 && change.queueAdded.length === 0 &&
    change.queueRemoved.length === 0 && Object.keys(change.fields).length === 0;
}

/**
 * Groups pick changes that involve a common player, so a pick moved from one slot
 * to another merges as one operation rather than as a separate removal and insertion.
 */
function groupPickChanges(picks: readonly DraftPickChange[]): DraftPickChange[][] {
  let groups: { readonly playerIds: ReadonlySet<string>; readonly picks: readonly DraftPickChange[] }[] = [];
  for (const pick of picks) {
    const playerIds = [pick.before?.playerId, pick.after?.playerId].filter((id) => id !== undefined);
    const joined = groups.filter((group) => playerIds.some((id) => group.playerIds.has(id)));
    groups = groups.filter((group) => !joined.includes(group));
    groups.push({
      playerIds: new Set([...playerIds, ...joined.flatMap((group) => [...group.playerIds])]),
      picks: [...joined.flatMap((group) => group.picks), pick],
    });
  }
  return groups.map((group) => [...group.picks]);
}

function canApplyPickGroup(history: ReadonlyMap<number, RecordedDraftPick>, group: readonly DraftPickChange[]): boolean {
  if (!group.every((pick) => isSameSessionValue(history.get(pick.pickNumber) ?? null, pick.before))) return false;
  const slots = new Set(group.map((pick) => pick.pickNumber));
  const draftedElsewhere = new Set(
    [...history.values()].filter((pick) => !slots.has(pick.pickNumber)).map((pick) => pick.playerId)
  );
  return !group.some(({ after }) => after && draftedElsewhere.has(after.playerId));
}

function mergePicks(draftHistory: readonly RecordedDraftPick[], picks: readonly DraftPickChange[]): RecordedDraftPick[] {
  const history = new Map(draftHistory.map((pick) => [pick.pickNumber, pick]));
  for (const group of groupPickChanges(picks)) {
    if (!canApplyPickGroup(history, group)) continue;
    for (const { pickNumber, after } of group) {
      if (after) history.set(pickNumber, after);
      else history.delete(pickNumber);
    }
  }
  return [...history.values()].sort((left, right) => left.pickNumber - right.pickNumber);
}

function mergeQueue(queue: readonly string[], change: DraftSessionChange): string[] {
  const removed = new Set(change.queueRemoved);
  const merged = queue.filter((playerId) => !removed.has(playerId));
  for (const playerId of change.queueAdded) if (!merged.includes(playerId)) merged.push(playerId);
  return merged;
}

function mergeFields(session: PersistedDraftSession, fields: FieldChanges): Partial<Record<MergedField, unknown>> {
  const merged: Partial<Record<MergedField, unknown>> = {};
  for (const field of MERGED_FIELDS) {
    const fieldChange = fields[field];
    if (fieldChange && isSameSessionValue(session[field], fieldChange.before)) merged[field] = fieldChange.after;
  }
  const cursor = fields.currentPick;
  if (cursor && !isSameSessionValue(session.currentPick, cursor.before)) {
    merged.currentPick = Math.max(session.currentPick, cursor.after);
  }
  return merged;
}

/** Merges an overwritten save into a newer session. The result is unvalidated; callers must parse it before use. */
export function applyDraftSessionChange(
  session: PersistedDraftSession,
  change: DraftSessionChange
): PersistedDraftSession {
  const merged: PersistedDraftSession = Object.assign({
    ...session,
    draftHistory: mergePicks(session.draftHistory, change.picks),
    shortlistedPlayerIds: mergeQueue(session.shortlistedPlayerIds, change),
  }, mergeFields(session, change.fields));
  if (merged.currentPick === session.currentPick && isSameSessionValue(merged.draftHistory, session.draftHistory)) return merged;
  // Recorded saves omit progress for older readers, so a moved cursor or history imports the legacy cursor.
  return { ...merged, draftProgress: {
    anchor: { kind: 'carry', pickNumber: merged.currentPick }, historyLength: merged.draftHistory.length,
  } };
}

function parseDraftSessionChange(serialized: string | null): DraftSessionChange | null {
  if (!serialized || serialized.length > 2_000_000) return null;
  try {
    return decodeDraftSessionChange(JSON.parse(serialized));
  } catch {
    return null;
  }
}

/** Records this tab's latest save before the session itself is written. */
export function writeDraftSessionChange(
  storage: DraftSessionStorage,
  identity: DraftSessionIdentity,
  tabId: string,
  change: DraftSessionChange
): void {
  const serialized = JSON.stringify({ version: 1, ...change });
  assertDraftStorageWritable(storage);
  try {
    storage.setItem(getUnconfirmedSaveKey(identity, tabId), serialized);
  } catch {
    // Without this record the save still lands; only overwrite recovery after reload is lost.
  }
}

/** Every tab's recorded save for this draft, including tabs that have since closed or reloaded. */
export function readDraftSessionChanges(
  storage: DraftSessionStorage,
  identity: DraftSessionIdentity
): StoredDraftSessionChange[] {
  try {
    const prefix = getUnconfirmedSaveKeyPrefix(identity);
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    let rejectedCount = 0;
    const changes = keys.flatMap((key) => {
      const serialized = storage.getItem(key);
      const change = parseDraftSessionChange(serialized);
      if (serialized && !change) rejectedCount += 1;
      return serialized && change ? [{ key, serialized, change }] : [];
    });
    if (rejectedCount > 0) {
      console.warn(
        '[Fantasy Draft] Rejected unconfirmed save journals; each save stays atomic to preserve dependent pick moves.',
        { rejectedCount }
      );
    }
    return changes;
  } catch {
    return [];
  }
}

/** Removes a recorded save unless its tab replaced it since it was read. */
export function removeDraftSessionChange(storage: DraftSessionStorage, stored: StoredDraftSessionChange): void {
  assertDraftStorageWritable(storage);
  try {
    if (storage.getItem(stored.key) === stored.serialized) {
      assertDraftStorageWritable(storage);
      storage.removeItem(stored.key);
    }
  } catch (error) {
    if (error instanceof DraftStorageMigratedError) throw error;
    // A leftover entry is removed by a later check.
  }
}

/**
 * How a recorded save relates to the stored session. `newest`: the session's latest
 * write, kept because a stale save could still overwrite it. `superseded`: a later
 * save built on it, so merging it again would undo later edits. `overwritten`: a
 * concurrent save replaced it, so it must be merged back.
 */
type RecordedSaveStatus = 'newest' | 'superseded' | 'overwritten';

function getRecordedSaveStatus(change: DraftSessionChange, session: PersistedDraftSession): RecordedSaveStatus {
  if (change.writeId === session.lineage.at(-1)) return 'newest';
  const oldestCoveredRevision = session.revision - session.lineage.length + 1;
  if (session.lineage.includes(change.writeId) || change.revision < oldestCoveredRevision) return 'superseded';
  return 'overwritten';
}

/**
 * Splits overwritten saves into those that build on the session's history, directly
 * or through another such save, and orphans built on a session outside it.
 */
function partitionByBase(
  overwritten: readonly StoredDraftSessionChange[],
  lineage: readonly string[]
): { readonly connected: StoredDraftSessionChange[]; readonly orphaned: StoredDraftSessionChange[] } {
  const reachable = new Set(lineage);
  const connected: StoredDraftSessionChange[] = [];
  let pending = [...overwritten];
  for (let progressed = true; progressed;) {
    const before = pending.length;
    pending = pending.filter((stored) => {
      const { baseWriteId, writeId } = stored.change;
      if (baseWriteId !== null && !reachable.has(baseWriteId)) return true;
      reachable.add(writeId);
      connected.push(stored);
      return false;
    });
    progressed = pending.length < before;
  }
  return { connected, orphaned: pending };
}

/** Removes recorded saves the session no longer needs and returns, oldest first, those it must merge back. */
export function takeOverwrittenSaves(
  storage: DraftSessionStorage,
  identity: DraftSessionIdentity,
  session: PersistedDraftSession
): DraftSessionChange[] {
  const recorded = readDraftSessionChanges(storage, identity);
  const superseded = recorded.filter(({ change }) => getRecordedSaveStatus(change, session) === 'superseded');
  const overwritten = recorded.filter(({ change }) => getRecordedSaveStatus(change, session) === 'overwritten');
  const { connected, orphaned } = partitionByBase(overwritten, session.lineage);
  for (const stored of [...superseded, ...orphaned]) removeDraftSessionChange(storage, stored);
  return connected.map(({ change }) => change).sort((left, right) => left.revision - right.revision);
}
