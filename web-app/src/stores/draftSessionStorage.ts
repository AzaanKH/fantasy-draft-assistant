import {
  isBoundedInteger,
  isDraftSize,
  isLeagueSettings,
  isPosition,
  isRosterRequirements,
  MAX_DRAFT_PICKS,
  type DraftProvider,
  type DraftType,
  type LeagueSettings,
} from '@fantasy-draft/shared';
import { canonicalizeKeeperSupply } from '@/lib/keeper-supply';
import { getTeamIndexForDraftPick } from '@/lib/mock-draft-engine';
import { isValidDraftSyncId } from './draftSyncStore';
import {
  computeDraftSessionChange,
  isEmptyDraftSessionChange,
  writeDraftSessionChange,
} from './draftSessionUnconfirmedSaves';
import type {
  DraftConfig,
  DraftStore,
  PreloadedKeeper,
  RecordedDraftPick,
  UnresolvedProviderPick,
} from './draft/types';

export interface DraftSessionIdentity {
  readonly provider: DraftProvider;
  readonly draftId: string;
}

/** Enumeration and removal let any tab find and clear every tab's recorded saves. */
export type DraftSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Canonical history doubles as the local journal, including provisional revisions. */
export interface PersistedDraftSession {
  readonly version: 1;
  /** Advances by one per lineage entry a write adds, so tabs can detect that another tab saved first. */
  readonly revision: number;
  /**
   * Recent write IDs this session includes, newest last: saves it builds on and
   * overwritten saves merged back into it. A recorded save missing from the
   * lineage was overwritten by a concurrent save and must be merged back.
   * Sessions saved before multi-tab merging have none.
   */
  readonly lineage: readonly string[];
  readonly identity: DraftSessionIdentity;
  readonly config: DraftConfig;
  readonly leagueSettings: LeagueSettings;
  readonly currentPick: number;
  readonly draftHistory: RecordedDraftPick[];
  readonly shortlistedPlayerIds: string[];
  readonly preloadedKeepers: PreloadedKeeper[];
  readonly keepersInitialized: boolean;
  readonly unresolvedProviderPicks: UnresolvedProviderPick[];
  readonly decisionLens: DraftStore['decisionLens'];
  readonly manualContinuityBaselineAt: number | null;
  readonly lastConfirmedSyncAt: number | null;
  readonly lastConfirmedPickNumber: number;
}

export function isDraftSessionIdentity(value: unknown): value is DraftSessionIdentity {
  if (!isRecord(value)) return false;
  return (value.provider === 'sleeper' || value.provider === 'espn' || value.provider === 'yahoo') &&
    isValidDraftSyncId(value.provider, value.draftId);
}

export function getDraftSessionStorageKey(identity: DraftSessionIdentity): string {
  return `fantasy-draft-session-v1:${identity.provider}:${identity.draftId}`;
}

/** Bounds the saved lineage; the revision advances once per entry so it stays aligned. */
export const DRAFT_SESSION_LINEAGE_LIMIT = 100;

export function getBrowserDraftSessionStorage(): DraftSessionStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

function isRecordedPick(value: unknown, config: DraftConfig): value is RecordedDraftPick {
  if (!isRecord(value)) return false;
  return isBoundedInteger(value.pickNumber, 1, config.totalTeams * config.totalRounds) &&
    isText(value.playerId) && isText(value.playerName) && isPosition(value.position) &&
    isBoundedInteger(value.teamIndex, 0, config.totalTeams - 1) && isText(value.teamName) &&
    isTimestamp(value.timestamp) &&
    (value.source === 'sync' || value.source === 'manual' || value.source === 'provisional' || value.source === 'keeper') &&
    (value.source !== 'provisional' || value.teamIndex === getTeamIndexForDraftPick(value.pickNumber, config.totalTeams, config.draftType)) &&
    (value.shortlistIndex === undefined || isBoundedInteger(value.shortlistIndex, 0, MAX_DRAFT_PICKS)) &&
    (value.provisionalRevision === undefined || isBoundedInteger(value.provisionalRevision, 0, Number.MAX_SAFE_INTEGER)) &&
    (value.provisionalUpdatedAt === undefined || isTimestamp(value.provisionalUpdatedAt));
}

function isKeeper(value: unknown, config: DraftConfig): value is PreloadedKeeper {
  return isRecord(value) && isText(value.playerId) && isText(value.playerName) &&
    isPosition(value.position) && isBoundedInteger(value.teamIndex, 0, config.totalTeams - 1) &&
    isBoundedInteger(value.round, 1, config.totalRounds) && typeof value.isMyKeeper === 'boolean';
}

function isUnresolvedPick(value: unknown, totalPicks: number): value is UnresolvedProviderPick {
  return isRecord(value) && isBoundedInteger(value.pickNumber, 1, totalPicks) &&
    isText(value.playerId) && isText(value.playerName) &&
    (value.nflTeam === null || isText(value.nflTeam));
}

export function parseStoredDraftSession(
  serialized: string | null,
  identity: DraftSessionIdentity
): PersistedDraftSession | null {
  if (!serialized || serialized.length > 2_000_000) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.version !== 1 || !isDraftSessionIdentity(value.identity) ||
        value.identity.provider !== identity.provider || value.identity.draftId !== identity.draftId ||
        !isRecord(value.config) || !isDraftSize(value.config.totalTeams, value.config.totalRounds) ||
        !isBoundedInteger(value.config.myPickPosition, 1, Number(value.config.totalTeams)) ||
        !isRosterRequirements(value.config.rosterRequirements) || !isLeagueSettings(value.leagueSettings) ||
        // Sessions saved before linear-draft support carry no draft type and were always snake.
        (value.config.draftType !== undefined && !(['snake', 'linear', 'auction'] as const).includes(value.config.draftType as DraftType))) return null;

    const config: DraftConfig = {
      totalTeams: Number(value.config.totalTeams),
      totalRounds: Number(value.config.totalRounds),
      draftType: (value.config.draftType as DraftType | undefined) ?? 'snake',
      myPickPosition: value.config.myPickPosition,
      rosterRequirements: value.config.rosterRequirements,
    };
    const totalPicks = config.totalTeams * config.totalRounds;
    if (!isBoundedInteger(value.currentPick, 1, totalPicks + 1) ||
        !Array.isArray(value.draftHistory) || value.draftHistory.length > totalPicks ||
        !value.draftHistory.every((pick: unknown) => isRecordedPick(pick, config)) ||
        !Array.isArray(value.preloadedKeepers) || value.preloadedKeepers.length > totalPicks ||
        !value.preloadedKeepers.every((keeper: unknown) => isKeeper(keeper, config)) ||
        !Array.isArray(value.shortlistedPlayerIds) || value.shortlistedPlayerIds.length > MAX_DRAFT_PICKS ||
        !value.shortlistedPlayerIds.every(isText) ||
        typeof value.keepersInitialized !== 'boolean' ||
        !Array.isArray(value.unresolvedProviderPicks) || value.unresolvedProviderPicks.length > totalPicks ||
        !value.unresolvedProviderPicks.every((pick: unknown) => isUnresolvedPick(pick, totalPicks)) ||
        (value.decisionLens !== 'best-pick' && value.decisionLens !== 'best-player') ||
        !isNullableTimestamp(value.manualContinuityBaselineAt) ||
        !isNullableTimestamp(value.lastConfirmedSyncAt) ||
        !isBoundedInteger(value.lastConfirmedPickNumber, 0, totalPicks) ||
        // Sessions saved before tab coordination carry no revision.
        (value.revision !== undefined && !isBoundedInteger(value.revision, 0, Number.MAX_SAFE_INTEGER)) ||
        (value.lineage !== undefined && !(Array.isArray(value.lineage) &&
          value.lineage.length <= DRAFT_SESSION_LINEAGE_LIMIT && value.lineage.every(isText))) ||
        (value.manualContinuityBaselineAt !== null && identity.provider !== 'sleeper')) return null;

    const draftHistory = value.draftHistory;
    const lineage: readonly string[] = value.lineage ?? [];
    const preloadedKeepers = value.preloadedKeepers;
    if (new Set(draftHistory.map((pick) => pick.pickNumber)).size !== draftHistory.length ||
        new Set(draftHistory.map((pick) => pick.playerId)).size !== draftHistory.length) return null;
    const supply = canonicalizeKeeperSupply(preloadedKeepers, config);
    if (supply.invalidEntries.length || supply.duplicatePlayerIds.length || supply.conflictingEntries.length) return null;

    return {
      version: 1,
      revision: value.revision ?? 0,
      identity: { provider: identity.provider, draftId: identity.draftId },
      config,
      leagueSettings: value.leagueSettings,
      currentPick: value.currentPick,
      draftHistory: [...draftHistory].sort((left, right) => left.pickNumber - right.pickNumber),
      shortlistedPlayerIds: [...new Set(value.shortlistedPlayerIds)],
      preloadedKeepers,
      keepersInitialized: value.keepersInitialized,
      unresolvedProviderPicks: value.unresolvedProviderPicks,
      decisionLens: value.decisionLens,
      manualContinuityBaselineAt: value.manualContinuityBaselineAt,
      lastConfirmedSyncAt: value.lastConfirmedSyncAt,
      lastConfirmedPickNumber: value.lastConfirmedPickNumber,
      lineage,
    };
  } catch {
    return null;
  }
}

/** The raw stored text, compared verbatim to detect any save by another tab. */
export function readStoredDraftSessionText(
  storage: DraftSessionStorage | null,
  identity: DraftSessionIdentity
): string | null {
  try {
    return storage?.getItem(getDraftSessionStorageKey(identity)) ?? null;
  } catch {
    return null;
  }
}

/** The stored session this tab last read or wrote, and therefore builds on. */
export interface DraftSessionBase {
  readonly revision: number;
  readonly serialized: string | null;
  readonly lineage: readonly string[];
  /** Parsed form of `serialized`, used to record what the next save changes. */
  readonly session: PersistedDraftSession | null;
}

export interface DraftSessionWriteOptions {
  /** Skips the conflict check, leaving the overwritten tab's save to be merged back. */
  readonly force?: boolean;
  /** Records this save under the tab's own key so any tab can merge it back. */
  readonly tabId?: string | null;
  /** Overwritten saves this session merges back, added to its lineage. */
  readonly mergedWriteIds?: readonly string[];
}

export type DraftSessionWriteResult =
  | { readonly status: 'written'; readonly writeId: string; readonly base: DraftSessionBase }
  | { readonly status: 'conflict' }
  | { readonly status: 'skipped' };

export function createDraftSessionWriteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Writes the session only if no other tab saved since `base`. On conflict the
 * caller must reapply its change to the newer session and try again.
 */
export function persistDraftSession(
  storage: DraftSessionStorage | null,
  state: DraftStore,
  base: DraftSessionBase,
  { force = false, tabId = null, mergedWriteIds = [] }: DraftSessionWriteOptions = {}
): DraftSessionWriteResult {
  if (!storage || !state.liveSession || state.sessionMode === 'mock') return { status: 'skipped' };
  const stored = readStoredDraftSessionText(storage, state.liveSession);
  // An unreadable entry cannot be adopted; overwrite it rather than stall.
  if (!force && stored !== base.serialized && parseStoredDraftSession(stored, state.liveSession)) {
    return { status: 'conflict' };
  }
  const writeId = createDraftSessionWriteId();
  const added = [...mergedWriteIds, writeId];
  const session: PersistedDraftSession = {
    version: 1,
    revision: base.revision + added.length,
    lineage: [...base.lineage, ...added].slice(-DRAFT_SESSION_LINEAGE_LIMIT),
    identity: state.liveSession,
    config: state.config,
    leagueSettings: state.leagueSettings,
    currentPick: state.currentPick,
    draftHistory: state.draftHistory,
    shortlistedPlayerIds: state.shortlistedPlayerIds,
    preloadedKeepers: state.preloadedKeepers,
    keepersInitialized: state.keepersInitialized,
    unresolvedProviderPicks: state.unresolvedProviderPicks,
    decisionLens: state.decisionLens,
    manualContinuityBaselineAt: state.manualContinuityBaselineAt,
    lastConfirmedSyncAt: state.lastConfirmedSyncAt,
    lastConfirmedPickNumber: state.lastConfirmedPickNumber,
  };
  const serialized = JSON.stringify(session);
  if (tabId) {
    // Recorded first, so a save overwritten before this tab notices survives a reload.
    const change = computeDraftSessionChange(base.session, session, writeId);
    if (!isEmptyDraftSessionChange(change)) writeDraftSessionChange(storage, state.liveSession, tabId, change);
  }
  try {
    // A single synchronous write keeps picks and queue changes durable before reload.
    storage.setItem(getDraftSessionStorageKey(state.liveSession), serialized);
    return {
      status: 'written',
      writeId,
      base: { revision: session.revision, serialized, lineage: session.lineage, session },
    };
  } catch {
    // Storage failure must not interrupt recording a local pick.
    return { status: 'skipped' };
  }
}
