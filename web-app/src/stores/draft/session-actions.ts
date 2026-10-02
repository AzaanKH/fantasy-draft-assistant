import { castDraft, type Draft } from 'immer';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared';
import { getEffectiveKeeperAssignments } from '@/lib/keeper-supply';
import {
  isDraftSessionIdentity,
  readDraftSession,
  type DraftSessionIdentity,
  type DraftSessionStorage,
  type PersistedDraftSession,
} from '../draftSessionStorage';
import { defaultConfig, defaultFilter, rebuildCanonicalRosters } from './state';
import type { DraftActions, SetDraftState, DraftStore } from './types';

/** The last saved revision this store loaded or wrote, shared with the persistence subscriber. */
export interface DraftSessionPersistence {
  revision: number;
}

/** Replaces durable session state with a saved session, rebuilding derived sets and rosters. */
export function applySavedDraftSession(
  state: Draft<DraftStore>,
  identity: DraftSessionIdentity | null,
  saved: PersistedDraftSession | null
): void {
  state.liveSession = identity ? { provider: identity.provider, draftId: identity.draftId } : null;
  state.sessionMode = saved ? 'live' : 'setup';
  state.config = castDraft(saved?.config ?? { ...defaultConfig });
  state.leagueSettings = castDraft(saved?.leagueSettings ?? createDefaultLeagueSettings());
  state.currentPick = saved?.currentPick ?? 1;
  state.draftHistory = saved?.draftHistory ?? [];
  state.shortlistedPlayerIds = saved?.shortlistedPlayerIds ?? [];
  state.preloadedKeepers = saved?.preloadedKeepers ?? [];
  state.keepersInitialized = saved?.keepersInitialized ?? false;
  state.unresolvedProviderPicks = saved?.unresolvedProviderPicks ?? [];
  state.manualContinuityBaselineAt = saved?.manualContinuityBaselineAt ?? null;
  state.lastConfirmedSyncAt = saved?.lastConfirmedSyncAt ?? null;
  state.lastConfirmedPickNumber = saved?.lastConfirmedPickNumber ?? 0;
  state.decisionLens = saved?.decisionLens ?? 'best-pick';
  state.mockSurvivalProbabilities = {};
  const effectiveKeepers = getEffectiveKeeperAssignments(
    state.preloadedKeepers, state.draftHistory, state.config.totalTeams,
    state.config.draftType
  );
  state.draftedPlayerIds = new Set([
    ...state.draftHistory.map((pick) => pick.playerId),
    ...effectiveKeepers.map((keeper) => keeper.playerId),
  ]);
  state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
    (playerId) => !state.draftedPlayerIds.has(playerId)
  );
  rebuildCanonicalRosters(state);
}

export function createSessionActions(
  set: SetDraftState,
  get: () => DraftStore,
  storage: DraftSessionStorage | null,
  persistence: DraftSessionPersistence
): Pick<
  DraftActions,
  'setSessionMode' |
  'setLiveDraftSession' |
  'enterManualContinuity'
> {
  return {
    setSessionMode: (mode) =>
      { set((state) => {
        state.sessionMode = mode;
        if (mode === 'mock') {
          state.liveSession = null;
          state.manualContinuityBaselineAt = null;
          state.lastConfirmedSyncAt = null;
          state.lastConfirmedPickNumber = 0;
        }
      }); },
    setLiveDraftSession: (identity) => {
      if (identity !== null && !isDraftSessionIdentity(identity)) return;
      const current = get().liveSession;
      if (current?.provider === identity?.provider && current?.draftId === identity?.draftId) return;
      const saved = identity ? readDraftSession(storage, identity) : null;
      persistence.revision = saved?.revision ?? 0;
      set((state) => {
        applySavedDraftSession(state, identity, saved);
        state.filter = { ...defaultFilter };
      });
    },
    enterManualContinuity: (baselineAt) => {
      if (!Number.isFinite(baselineAt) || baselineAt < 0) return;
      set((state) => {
        if (state.sessionMode !== 'live' || state.liveSession?.provider !== 'sleeper') return;
        state.manualContinuityBaselineAt = baselineAt;
      });
    },
  };
}
