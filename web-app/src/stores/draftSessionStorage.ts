import { type LeagueSettings } from '@fantasy-draft/shared/league';
import { DRAFT_SESSION_LINEAGE_LIMIT, type DraftSessionIdentity } from '@fantasy-draft/shared/sync';
export type { DraftSessionIdentity } from '@fantasy-draft/shared/sync';
import { canonicalizeKeeperSupply, type DraftProgress } from '@fantasy-draft/shared/draft';
import { decodeStoredDraftSession } from '@fantasy-draft/shared/catalog';
export { DRAFT_SESSION_LINEAGE_LIMIT } from '@fantasy-draft/shared/sync';
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

/** Enumeration and removal let any tab find and clear every tab's recorded saves. */
export type DraftSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Canonical history doubles as the local journal, including provisional revisions. */
export interface PersistedDraftSession {
  readonly version: 2;
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
  readonly draftProgress: DraftProgress;
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

export function parseStoredDraftSession(
  serialized: string | null,
  identity: DraftSessionIdentity
): PersistedDraftSession | null {
  if (!serialized || serialized.length > 2_000_000) return null;
  try {
    const value = decodeStoredDraftSession(JSON.parse(serialized));
    if (value.identity.provider !== identity.provider || value.identity.draftId !== identity.draftId) return null;
    const config: DraftConfig = {
      totalTeams: value.config.totalTeams,
      totalRounds: value.config.totalRounds,
      myPickPosition: value.config.myPickPosition,
      rosterRequirements: value.config.rosterRequirements,
      // eslint-disable-next-line no-restricted-syntax -- Version 1 sessions predating draftType used snake order.
      draftType: value.config.draftType ?? 'snake',
    };
    const draftHistory = value.draftHistory;
    const lineage: readonly string[] = value.lineage ?? [];
    const preloadedKeepers = value.preloadedKeepers;
    if (new Set(draftHistory.map((pick) => pick.pickNumber)).size !== draftHistory.length ||
        new Set(draftHistory.map((pick) => pick.playerId)).size !== draftHistory.length) return null;
    const supply = canonicalizeKeeperSupply(preloadedKeepers, config);
    if (supply.invalidEntries.length || supply.duplicatePlayerIds.length || supply.conflictingEntries.length) return null;

    return {
      version: 2,
      revision: value.revision ?? 0,
      identity: { provider: identity.provider, draftId: identity.draftId },
      config,
      leagueSettings: value.leagueSettings,
      currentPick: value.currentPick,
      draftProgress: value.draftProgress,
      draftHistory: [...draftHistory],
      shortlistedPlayerIds: [...new Set(value.shortlistedPlayerIds)],
      preloadedKeepers: [...preloadedKeepers],
      keepersInitialized: value.keepersInitialized,
      unresolvedProviderPicks: [...value.unresolvedProviderPicks],
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

interface DraftSessionWriteOptions {
  /** Skips the conflict check, leaving the overwritten tab's save to be merged back. */
  readonly force?: boolean;
  /** Records this save under the tab's own key so any tab can merge it back. */
  readonly tabId?: string | null;
  /** Overwritten saves this session merges back, added to its lineage. */
  readonly mergedWriteIds?: readonly string[];
}

type DraftSessionWriteResult =
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
    version: 2,
    revision: base.revision + added.length,
    lineage: [...base.lineage, ...added].slice(-DRAFT_SESSION_LINEAGE_LIMIT),
    identity: state.liveSession,
    config: state.config,
    leagueSettings: state.leagueSettings,
    currentPick: state.currentPick,
    draftProgress: state.draftProgress,
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
