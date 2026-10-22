import {
  decodeDraftSessionChange,
  decodeDraftSessionIdentity,
  decodeStoredDraftKeeper,
  decodeStoredDraftPick,
  decodeStoredDraftProgress,
  decodeStoredDraftSessionRecord,
  decodeStoredPlayerId,
  decodeStoredUnresolvedPick,
} from '@fantasy-draft/shared/catalog';
import { createSlotSequence, deriveDraftCursor } from '@fantasy-draft/shared/draft';
import type { DraftProgress } from '@fantasy-draft/shared/draft';
import { DRAFT_SESSION_LINEAGE_LIMIT } from '@fantasy-draft/shared/sync';
import { MAX_DRAFT_PICKS } from '@fantasy-draft/shared/units';
import type { DraftSessionIdentity, PersistedDraftSession } from '../stores/draftSessionStorage';
import type { DraftSessionChange } from '../stores/draftSessionUnconfirmedSaves';

export interface RawV1Entry {
  readonly key: string;
  readonly serialized: string;
}

export interface V1Import {
  readonly sessions: PersistedDraftSession[];
  readonly rejected: { key: string; serialized: string; path: string; reason: string }[];
  readonly unresolved: { key: string; serialized: string; change: DraftSessionChange }[];
  readonly source: RawV1Entry[];
}

const SESSION_PREFIX = 'fantasy-draft-session-v1:';
const JOURNAL_PREFIX = 'fantasy-draft-session-unconfirmed-v1:';
type StorageReader = Pick<Storage, 'length' | 'key' | 'getItem'>;
type Reject = (path: string, value: unknown, reason: string) => void;
type Journal = RawV1Entry & {
  identity: DraftSessionIdentity;
  change: DraftSessionChange;
  complete: boolean;
};

/** Storage errors and a disappearing record abort the snapshot, rather than import empty data. */
export function snapshotV1Storage(storage: StorageReader): RawV1Entry[] {
  const entries: RawV1Entry[] = [];
  const length = storage.length;
  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index);
    if (key === null) throw new Error('Storage changed while copying v1 keys');
    if (!key.startsWith(SESSION_PREFIX) && !key.startsWith(JOURNAL_PREFIX)) continue;
    const serialized = storage.getItem(key);
    if (serialized === null) throw new Error(`Storage changed while copying ${key}`);
    entries.push({ key, serialized });
  }
  if (storage.length !== length) throw new Error('Storage changed while copying v1 records');
  return entries;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decode<T>(value: unknown, path: string, decoder: (input: unknown) => T, reject: Reject): T | undefined {
  try {
    return decoder(value);
  } catch (error) {
    reject(path, value, errorReason(error));
    return undefined;
  }
}

function entries<T>(value: unknown, path: string, decoder: (input: unknown, index: number) => T, reject: Reject, limit = MAX_DRAFT_PICKS): T[] {
  if (!Array.isArray(value)) {
    reject(path, value, 'Expected an array');
    return [];
  }
  const accepted: T[] = [];
  value.forEach((entry: unknown, index) => {
    if (accepted.length >= limit) { reject(`${path}[${index}]`, entry, 'Collection exceeds the session entry limit'); return; }
    const decoded = decode(entry, `${path}[${index}]`, input => decoder(input, index), reject);
    if (decoded !== undefined) accepted.push(decoded);
  });
  return accepted;
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.entries(left).filter(([, value]) => value !== undefined);
  const b = Object.entries(right).filter(([, value]) => value !== undefined);
  return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key) && same(value, Reflect.get(right, key)));
}

function identityFromKey(key: string, journal: boolean): DraftSessionIdentity {
  const parts = key.slice(journal ? JOURNAL_PREFIX.length : SESSION_PREFIX.length).split(':');
  if (parts.length !== (journal ? 3 : 2) || journal && !parts[2]) throw new Error('Invalid v1 storage key');
  return decodeDraftSessionIdentity({ provider: parts[0], draftId: parts[1] });
}

function identityKey(identity: DraftSessionIdentity): string {
  return `${identity.provider}:${identity.draftId}`;
}

function carry(session: Pick<PersistedDraftSession, 'currentPick' | 'draftHistory'>): DraftProgress {
  return { anchor: { kind: 'carry', pickNumber: session.currentPick }, historyLength: session.draftHistory.length };
}

function decodeSession(value: Record<string, unknown>, identity: DraftSessionIdentity, reject: Reject): PersistedDraftSession {
  const header = decodeStoredDraftSessionRecord({
    ...value, draftHistory: [], preloadedKeepers: [], shortlistedPlayerIds: [], unresolvedProviderPicks: [],
  });
  if (!same(header.identity, identity)) throw new Error('Session identity does not match its storage key');
  const config = {
    ...header.config,
    // eslint-disable-next-line no-restricted-syntax -- v1 records predating draftType used snake order.
    draftType: header.config.draftType ?? 'snake',
  };
  const total = config.totalTeams * config.totalRounds;
  const sequence = createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds });
  const slots = new Set<number>();
  const players = new Set<string>();
  const acceptedHistory = new Set<number>();
  const draftHistory = entries(value.draftHistory, '$.draftHistory', (input, index) => {
    const pick = decodeStoredDraftPick(input);
    if (pick.pickNumber > total || pick.teamIndex >= config.totalTeams ||
        pick.source === 'provisional' && pick.teamIndex !== sequence.at(pick.pickNumber).teamIndex) {
      throw new Error('Pick is outside the session draft configuration');
    }
    if (slots.has(pick.pickNumber) || players.has(pick.playerId)) throw new Error('Duplicate pick slot or player');
    slots.add(pick.pickNumber);
    players.add(pick.playerId);
    acceptedHistory.add(index);
    return pick;
  }, reject);
  const keeperSlots = new Set<number>();
  const keeperPlayers = new Set<string>();
  const preloadedKeepers = entries(value.preloadedKeepers, '$.preloadedKeepers', input => {
    const keeper = decodeStoredDraftKeeper(input);
    if (keeper.teamIndex >= config.totalTeams || keeper.round > config.totalRounds) throw new Error('Keeper is outside the session draft configuration');
    const slot = sequence.forTeamRound(keeper.teamIndex, keeper.round).pick;
    if (keeperSlots.has(slot) || keeperPlayers.has(keeper.playerId)) throw new Error('Duplicate keeper slot or player');
    keeperSlots.add(slot);
    keeperPlayers.add(keeper.playerId);
    return keeper;
  }, reject);
  const unresolvedProviderPicks = entries(value.unresolvedProviderPicks, '$.unresolvedProviderPicks', input => {
    const pick = decodeStoredUnresolvedPick(input);
    if (pick.pickNumber > total) throw new Error('Unresolved pick is outside the session draft configuration');
    return pick;
  }, reject, total);
  const session: PersistedDraftSession = {
    ...header, config, revision: header.revision ?? 0, lineage: [...header.lineage ?? []],
    draftHistory, preloadedKeepers, unresolvedProviderPicks,
    shortlistedPlayerIds: [...new Set(entries(value.shortlistedPlayerIds, '$.shortlistedPlayerIds', input => decodeStoredPlayerId(input), reject))],
    draftProgress: { anchor: { kind: 'carry', pickNumber: header.currentPick }, historyLength: draftHistory.length },
  };
  if (value.draftProgress !== undefined) {
    const progress = decode(value.draftProgress, '$.draftProgress', input => {
      const decoded = decodeStoredDraftProgress(input);
      const original: unknown[] = Array.isArray(value.draftHistory) ? value.draftHistory : [];
      if (decoded.historyLength > original.length) throw new Error('Progress prefix exceeds the saved history');
      // v1 counts this prefix in pick order, even when bytes store insertion order.
      const ranked = original.map((raw: unknown, index) => {
        const pick = record(raw);
        if (typeof pick.pickNumber !== 'number' || !Number.isSafeInteger(pick.pickNumber)) {
          throw new Error('Cannot recover the progress prefix through an unranked rejected pick');
        }
        return { pickNumber: pick.pickNumber, index };
      }).sort((a, b) => a.pickNumber - b.pickNumber);
      const progress = { ...decoded, historyLength: ranked.slice(0, decoded.historyLength).filter(row => acceptedHistory.has(row.index)).length };
      const ordered = [...draftHistory].sort((a, b) => a.pickNumber - b.pickNumber);
      if (deriveDraftCursor(ordered, progress) !== header.currentPick) {
        throw new Error('Progress does not match the accepted history and saved cursor');
      }
      return { ...progress, historyOrder: 'pick' as const };
    }, reject);
    if (progress) return { ...session, draftProgress: progress };
  }
  return session;
}

function pickTokens(value: unknown): Set<string> {
  const tokens = new Set<string>();
  if (value === null || typeof value !== 'object') return tokens;
  if ('pickNumber' in value && typeof value.pickNumber === 'number') tokens.add(`slot:${value.pickNumber}`);
  for (const name of ['before', 'after']) {
    const pick: unknown = Reflect.get(value, name);
    if (pick !== null && typeof pick === 'object' && 'playerId' in pick && typeof pick.playerId === 'string') {
      tokens.add(`player:${pick.playerId}`);
    }
  }
  return tokens;
}

function pickGroups<T>(values: readonly T[], tokens: (value: T) => Set<string>): T[][] {
  let groups: { values: T[]; tokens: Set<string> }[] = [];
  for (const value of values) {
    const keys = tokens(value);
    const joined = groups.filter(group => [...keys].some(key => group.tokens.has(key)));
    groups = groups.filter(group => !joined.includes(group));
    groups.push({ values: [...joined.flatMap(group => group.values), value],
      tokens: new Set([...keys, ...joined.flatMap(group => [...group.tokens])]) });
  }
  return groups.map(group => group.values);
}

function decodeJournal(value: Record<string, unknown>, reject: Reject): { change: DraftSessionChange; complete: boolean } {
  const header = decodeDraftSessionChange({ ...value, picks: [], queueAdded: [], queueRemoved: [], fields: {} });
  let complete = true;
  const rejected: Reject = (path, raw, reason) => { complete = false; reject(path, raw, reason); };
  const rawPicks: unknown[] = Array.isArray(value.picks) ? value.picks : [];
  if (!Array.isArray(value.picks)) rejected('$.picks', value.picks, 'Expected an array');
  const decoded = rawPicks.map((raw, index) => ({ raw, index, pick: decode(raw, `$.picks[${index}]`, input => {
    const pick = decodeDraftSessionChange({ ...header, picks: [input] }).picks[0];
    if (!pick || pick.before?.pickNumber !== undefined && pick.before.pickNumber !== pick.pickNumber ||
        pick.after?.pickNumber !== undefined && pick.after.pickNumber !== pick.pickNumber || !pick.before && !pick.after) {
      throw new Error('Pick change must describe its own slot');
    }
    return pick;
  }, rejected) }));
  const groups = pickGroups(decoded, item => pickTokens(item.raw));
  // An unidentifiable corrupt member could be the destination of any removal.
  const unknownDependency = decoded.some(item => !item.pick && ['before', 'after'].some(name => {
    if (item.raw === null || typeof item.raw !== 'object') return true;
    const member: unknown = Reflect.get(item.raw, name);
    return member !== null && (typeof member !== 'object' || !('playerId' in member) || typeof member.playerId !== 'string');
  }));
  const picks = groups.flatMap(group => !unknownDependency && group.every(item => item.pick !== undefined)
    ? group.flatMap(item => item.pick ? [item.pick] : []) : []);
  const fields: DraftSessionChange['fields'] = {};
  const rawFields = decode(value.fields, '$.fields', record, rejected);
  for (const [field, raw] of Object.entries(rawFields ?? {})) {
    const decodedField = decode(raw, `$.fields.${field}`, input =>
      decodeDraftSessionChange({ ...header, fields: { [field]: input } }).fields, rejected);
    if (decodedField && (field !== 'currentPick' || complete)) Object.assign(fields, decodedField);
  }
  return { change: { ...header, picks, fields,
    queueAdded: [...new Set(entries(value.queueAdded, '$.queueAdded', input => decodeStoredPlayerId(input), rejected))],
    queueRemoved: [...new Set(entries(value.queueRemoved, '$.queueRemoved', input => decodeStoredPlayerId(input), rejected))],
  }, complete };
}

function applyJournal(session: PersistedDraftSession, change: DraftSessionChange): { session: PersistedDraftSession; complete: boolean } {
  const history = new Map(session.draftHistory.map(pick => [pick.pickNumber, pick]));
  let complete = true;
  for (const group of pickGroups(change.picks, pickTokens)) {
    if (group.every(pick => same(history.get(pick.pickNumber) ?? null, pick.after))) continue;
    const slots = new Set(group.map(pick => pick.pickNumber));
    const others = new Set([...history.values()].filter(pick => !slots.has(pick.pickNumber)).map(pick => pick.playerId));
    const added = group.flatMap(pick => pick.after ? [pick.after.playerId] : []);
    if (slots.size !== group.length || new Set(added).size !== added.length ||
        !group.every(pick => same(history.get(pick.pickNumber) ?? null, pick.before)) ||
        added.some(id => others.has(id))) {
      complete = false;
      continue;
    }
    const candidate = new Map(history);
    for (const { pickNumber, after } of group) {
      if (after) candidate.set(pickNumber, after);
      else candidate.delete(pickNumber);
    }
    try {
      decodeStoredDraftSessionRecord({ ...session, draftHistory: [...candidate.values()] });
      history.clear();
      for (const [slot, pick] of candidate) history.set(slot, pick);
    } catch {
      complete = false;
    }
  }
  const merged = { ...session, draftHistory: [...history.values()] };
  for (const field of Object.keys(change.fields)) {
    const fieldChange = change.fields[field as keyof DraftSessionChange['fields']];
    if (!fieldChange || field === 'currentPick' && !complete) continue;
    const current: unknown = Reflect.get(merged, field);
    if (same(current, fieldChange.after)) continue;
    if (!same(current, fieldChange.before)) { complete = false; continue; }
    const candidate = { ...merged, [field]: fieldChange.after };
    try {
      decodeStoredDraftSessionRecord(candidate);
      if (new Set(candidate.preloadedKeepers.map(keeper => keeper.playerId)).size !== candidate.preloadedKeepers.length ||
          new Set(candidate.preloadedKeepers.map(keeper => `${keeper.teamIndex}:${keeper.round}`)).size !== candidate.preloadedKeepers.length) {
        complete = false;
        continue;
      }
      Object.assign(merged, { [field]: fieldChange.after });
    } catch {
      complete = false;
    }
  }
  const removed = new Set(change.queueRemoved);
  merged.shortlistedPlayerIds = [...new Set([...session.shortlistedPlayerIds.filter(id => !removed.has(id)), ...change.queueAdded])];
  if (!same(merged.draftHistory, session.draftHistory) || merged.currentPick !== session.currentPick) merged.draftProgress = carry(merged);
  return { session: merged, complete };
}

/** Decodes a copied snapshot without creating a v1 store or mutating browser storage. */
export function importV1(entries: readonly RawV1Entry[]): V1Import {
  const result: V1Import = { sessions: [], rejected: [], unresolved: [], source: entries.map(entry => ({ ...entry })) };
  const sessions = new Map<string, PersistedDraftSession>();
  const journals: Journal[] = [];
  const diagnostics = new Set<string>();
  const seen = new Set<string>();
  for (const entry of result.source) {
    const reject: Reject = (path, value, reason) => {
      const diagnostic = JSON.stringify([entry.key, entry.serialized, value]);
      if (diagnostics.has(diagnostic)) return;
      diagnostics.add(diagnostic);
      result.rejected.push({ ...entry, path, reason });
    };
    if (seen.has(entry.key)) { reject('$', entry.serialized, 'Duplicate storage key in snapshot'); continue; }
    seen.add(entry.key);
    try {
      const journal = entry.key.startsWith(JOURNAL_PREFIX);
      if (!journal && !entry.key.startsWith(SESSION_PREFIX)) throw new Error('Not a v1 session or journal key');
      const identity = identityFromKey(entry.key, journal);
      if (entry.serialized.length > 2_000_000) throw new Error('v1 record exceeds 2,000,000 characters');
      const raw: unknown = JSON.parse(entry.serialized);
      const value = record(raw);
      if (journal) journals.push({ ...entry, identity, ...decodeJournal(value, reject) });
      else sessions.set(identityKey(identity), decodeSession(value, identity, reject));
    } catch (error) {
      reject('$', entry.serialized, errorReason(error));
    }
  }
  for (const [key, saved] of sessions) {
    let session = saved;
    const resolved = new Set(session.lineage);
    let pending = journals.filter(journal => identityKey(journal.identity) === key && !resolved.has(journal.change.writeId));
    pending.sort((a, b) => a.change.revision - b.change.revision);
    for (let progressed = true; progressed;) {
      progressed = false;
      const remaining: Journal[] = [];
      for (const journal of pending) {
        if (journal.change.baseWriteId !== null && !resolved.has(journal.change.baseWriteId)) { remaining.push(journal); continue; }
        const applied = applyJournal(session, journal.change);
        session = applied.session;
        if (journal.complete && applied.complete) {
          resolved.add(journal.change.writeId);
          session = { ...session, revision: Math.max(session.revision, journal.change.revision),
            lineage: [...new Set([...session.lineage, journal.change.writeId])].slice(-DRAFT_SESSION_LINEAGE_LIMIT) };
          progressed = true;
        } else if (journal.complete) remaining.push(journal);
      }
      pending = remaining;
    }
    result.unresolved.push(...pending.filter(journal => journal.complete).map(({ key, serialized, change }) => ({ key, serialized, change })));
    result.sessions.push(session);
  }
  result.unresolved.push(...journals.filter(journal => journal.complete && !sessions.has(identityKey(journal.identity)))
    .map(({ key, serialized, change }) => ({ key, serialized, change })));
  return result;
}
