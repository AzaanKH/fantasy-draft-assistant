import { deriveDraftState } from './source';
import { castDraft, type Draft } from 'immer';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import type { DraftSessionIdentity, PersistedDraftSession } from '../draftSessionStorage';
import { defaultConfig } from './state';
import type { DraftState } from './types';

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
