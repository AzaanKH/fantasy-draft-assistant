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
import { getTeamIndexForPick } from '@/lib/mock-draft-engine';
import { isValidDraftSyncId } from './draftSyncStore';
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

export type DraftSessionStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Canonical history doubles as the local journal, including provisional revisions. */
export interface PersistedDraftSession {
  readonly version: 1;
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
    (value.source !== 'provisional' || value.teamIndex === getTeamIndexForPick(value.pickNumber, config.totalTeams)) &&
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
        (value.manualContinuityBaselineAt !== null && identity.provider !== 'sleeper')) return null;

    const draftHistory = value.draftHistory;
    const preloadedKeepers = value.preloadedKeepers;
    if (new Set(draftHistory.map((pick) => pick.pickNumber)).size !== draftHistory.length ||
        new Set(draftHistory.map((pick) => pick.playerId)).size !== draftHistory.length) return null;
    const supply = canonicalizeKeeperSupply(preloadedKeepers, config);
    if (supply.invalidEntries.length || supply.duplicatePlayerIds.length || supply.conflictingEntries.length) return null;

    return {
      version: 1,
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
    };
  } catch {
    return null;
  }
}

export function readDraftSession(
  storage: DraftSessionStorage | null,
  identity: DraftSessionIdentity
): PersistedDraftSession | null {
  try {
    return parseStoredDraftSession(storage?.getItem(getDraftSessionStorageKey(identity)) ?? null, identity);
  } catch {
    return null;
  }
}

export function persistDraftSession(storage: DraftSessionStorage | null, state: DraftStore): void {
  if (!storage || !state.liveSession || state.sessionMode === 'mock') return;
  const session: PersistedDraftSession = {
    version: 1,
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
  try {
    // Synchronous writes keep picks and queue changes durable before reload.
    storage.setItem(getDraftSessionStorageKey(state.liveSession), JSON.stringify(session));
  } catch {
    // Storage failure must not interrupt recording a local pick.
  }
}
