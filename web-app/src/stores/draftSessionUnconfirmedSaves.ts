import { isBoundedInteger, MAX_DRAFT_PICKS } from '@fantasy-draft/shared';
import type { RecordedDraftPick } from './draft/types';
import type {
  DraftSessionIdentity,
  DraftSessionStorage,
  PersistedDraftSession,
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

function getUnconfirmedSaveKeyPrefix(identity: DraftSessionIdentity): string {
  // Draft IDs never contain a colon, so the prefix cannot match another draft.
  return `fantasy-draft-session-unconfirmed-v1:${identity.provider}:${identity.draftId}:`;
}

/** Each tab keeps its latest save under its own key, which no other tab writes. */
function getUnconfirmedSaveKey(identity: DraftSessionIdentity, tabId: string): string {
  return `${getUnconfirmedSaveKeyPrefix(identity)}${tabId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

/** Deep equality for JSON data; key order and undefined properties are ignored. */
function isSameSessionValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightValues = right as Record<string, unknown>;
  return leftEntries.length === Object.values(right).filter((value) => value !== undefined).length &&
    leftEntries.every(([key, value]) => Object.hasOwn(right, key) && isSameSessionValue(value, rightValues[key]));
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

/**
 * Merges an overwritten save into a newer session. Picks merge by pick number and
 * the queue by adds and removes. Where both saves changed the same pick or field,
 * the newer session wins; a later pick is still never placed behind the merged picks.
 * Pick changes involving the same player, such as a move, apply together or not at
 * all, so a conflicting destination never leaves the original pick deleted.
 * The result is unvalidated; callers must parse it before use.
 */
export function applyDraftSessionChange(
  session: PersistedDraftSession,
  change: DraftSessionChange
): PersistedDraftSession {
  const history = new Map(session.draftHistory.map((pick) => [pick.pickNumber, pick]));
  for (const group of groupPickChanges(change.picks)) {
    if (!group.every((pick) => isSameSessionValue(history.get(pick.pickNumber) ?? null, pick.before))) continue;
    const slots = new Set(group.map((pick) => pick.pickNumber));
    // A player the newer session drafted at another pick stays there, and these slots keep their picks.
    const draftedElsewhere = new Set(
      [...history.values()].filter((pick) => !slots.has(pick.pickNumber)).map((pick) => pick.playerId)
    );
    if (group.some(({ after }) => after && draftedElsewhere.has(after.playerId))) continue;
    for (const { pickNumber, after } of group) {
      if (after) history.set(pickNumber, after);
      else history.delete(pickNumber);
    }
  }

  const removed = new Set(change.queueRemoved);
  const queue = session.shortlistedPlayerIds.filter((playerId) => !removed.has(playerId));
  for (const playerId of change.queueAdded) if (!queue.includes(playerId)) queue.push(playerId);

  const merged: Record<string, unknown> = {
    ...session,
    draftHistory: [...history.values()].sort((left, right) => left.pickNumber - right.pickNumber),
    shortlistedPlayerIds: queue,
  };
  for (const field of MERGED_FIELDS) {
    const fieldChange = change.fields[field];
    if (!fieldChange) continue;
    if (isSameSessionValue(session[field], fieldChange.before)) {
      merged[field] = fieldChange.after;
    } else if (field === 'currentPick') {
      merged[field] = Math.max(session.currentPick, fieldChange.after as number);
    }
  }
  return merged as unknown as PersistedDraftSession;
}

function isPickChange(value: unknown): value is DraftPickChange {
  return isRecord(value) && isBoundedInteger(value.pickNumber, 1, MAX_DRAFT_PICKS) &&
    (value.before === null || isRecord(value.before)) && (value.after === null || isRecord(value.after));
}

function isPlayerIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_DRAFT_PICKS && value.every(isText);
}

function parseDraftSessionChange(serialized: string | null): DraftSessionChange | null {
  if (!serialized || serialized.length > 2_000_000) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    // Only the shape is checked here; merged values are validated with the merged session.
    if (!isRecord(value) || value.version !== 1 || !isText(value.writeId) ||
        (value.baseWriteId !== null && !isText(value.baseWriteId)) ||
        !isBoundedInteger(value.revision, 0, Number.MAX_SAFE_INTEGER) ||
        !Array.isArray(value.picks) || value.picks.length > MAX_DRAFT_PICKS || !value.picks.every(isPickChange) ||
        !isPlayerIdList(value.queueAdded) || !isPlayerIdList(value.queueRemoved) ||
        !isRecord(value.fields) ||
        !Object.entries(value.fields).every(([field, fieldChange]) =>
          (MERGED_FIELDS as readonly string[]).includes(field) && isRecord(fieldChange) &&
          'before' in fieldChange && 'after' in fieldChange)) return null;
    return {
      writeId: value.writeId,
      baseWriteId: value.baseWriteId,
      revision: value.revision,
      picks: value.picks,
      queueAdded: value.queueAdded,
      queueRemoved: value.queueRemoved,
      fields: value.fields as FieldChanges,
    };
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
  try {
    storage.setItem(getUnconfirmedSaveKey(identity, tabId), JSON.stringify({ version: 1, ...change }));
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
    return keys.flatMap((key) => {
      const serialized = storage.getItem(key);
      const change = parseDraftSessionChange(serialized);
      return serialized && change ? [{ key, serialized, change }] : [];
    });
  } catch {
    return [];
  }
}

/** Removes a recorded save unless its tab replaced it since it was read. */
export function removeDraftSessionChange(storage: DraftSessionStorage, stored: StoredDraftSessionChange): void {
  try {
    if (storage.getItem(stored.key) === stored.serialized) storage.removeItem(stored.key);
  } catch {
    // A leftover entry is removed by a later check.
  }
}
