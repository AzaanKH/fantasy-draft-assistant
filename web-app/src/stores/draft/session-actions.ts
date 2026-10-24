import { createModeActions } from './mode-actions';
import { deriveDraftState } from './source';
import { isDraftSessionIdentity } from '@fantasy-draft/shared/sync';
import { castDraft, type Draft } from 'immer';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import {
  parseStoredDraftSession,
  readStoredDraftSessionText,
  type DraftSessionBase,
  type DraftSessionIdentity,
  type DraftSessionStorage,
  type PersistedDraftSession,
} from '../draftSessionStorage';
import { defaultConfig, defaultFilter } from './state';
import type { DraftActions, SetDraftState, DraftStore, DraftState } from './types';

/** The saved session this store last loaded or wrote, shared with the persistence subscriber. */
export interface DraftSessionPersistence {
  base: DraftSessionBase;
}

export const EMPTY_DRAFT_SESSION_BASE: DraftSessionBase = { revision: 0, serialized: null, lineage: [], session: null };

export function applySavedDraftSession(
  state: Draft<DraftState>,
  identity: DraftSessionIdentity | null,
  saved: PersistedDraftSession | null
): void {
  if (state.liveSession?.provider !== identity?.provider || state.liveSession?.draftId !== identity?.draftId) state.connectionPreferences = undefined;
  state.liveSession = identity ? { provider: identity.provider, draftId: identity.draftId } : null;
  state.sessionMode = saved ? 'live' : 'setup';
  state.config = castDraft(saved?.config ?? { ...defaultConfig });
  state.leagueSettings = castDraft(saved?.leagueSettings ?? createDefaultLeagueSettings());
  state.draftHistory = saved?.draftHistory ?? [];
  state.draftProgress = castDraft(saved?.draftProgress ?? {
    anchor: { kind: 'carry', pickNumber: 1 }, historyLength: 0,
  });
  state.shortlistedPlayerIds = saved?.shortlistedPlayerIds ?? [];
  state.preloadedKeepers = saved?.preloadedKeepers ?? [];
  state.keepersInitialized = saved?.keepersInitialized ?? false;
  state.unresolvedProviderPicks = saved?.unresolvedProviderPicks ?? [];
  state.manualContinuityBaselineAt = saved?.manualContinuityBaselineAt ?? null;
  state.lastConfirmedSyncAt = saved?.lastConfirmedSyncAt ?? null;
  state.lastConfirmedPickNumber = saved?.lastConfirmedPickNumber ?? 0;
  state.decisionLens = saved?.decisionLens ?? 'best-pick';
  state.mockSurvivalProbabilities = {};
  state.shortlistedPlayerIds = [...deriveDraftState(state).shortlistedPlayerIds];
}

export function createSessionActions(
  set: SetDraftState,
  get: () => DraftStore,
  storage: DraftSessionStorage | null,
  persistence: DraftSessionPersistence,
  loadSession: SetDraftState = set
): Pick<
  DraftActions,
  'setSessionMode' |
  'setLiveDraftSession' |
  'enterManualContinuity'
> {
  return {
    ...createModeActions(set),
    setLiveDraftSession: (identity) => {
      if (identity !== null && !isDraftSessionIdentity(identity)) return;
      const current = get().liveSession;
      if (current?.provider === identity?.provider && current?.draftId === identity?.draftId) return;
      const serialized = identity ? readStoredDraftSessionText(storage, identity) : null;
      const saved = identity ? parseStoredDraftSession(serialized, identity) : null;
      loadSession((state) => {
        // Rebase inside the transition, after the pre-change check of the previous session.
        persistence.base = saved
          ? { revision: saved.revision, serialized, lineage: saved.lineage, session: saved }
          : EMPTY_DRAFT_SESSION_BASE;
        applySavedDraftSession(state, identity, saved);
        state.filter = { ...defaultFilter };
      });
    },

  };
}
