import { createModeActions } from '@/stores/draft/mode-actions';
import { dispatchDraftCommand } from './dispatch-command';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { deriveDraftCursor } from '@fantasy-draft/shared/draft';
import { createConfigurationActions } from '@/stores/draft/configuration-actions';
import { createPickActions } from '@/stores/draft/pick-actions';
import { createProvisionalActions } from '@/stores/draft/provisional-actions';
import { createReconciliationActions } from '@/stores/draft/reconciliation';
import { defaultConfig, defaultFilter, defaultMockSettings, runDraftTransition } from '@/stores/draft/state';
import type { DraftActions, DraftState, SetDraftState } from '@/stores/draft/types';
import type { DraftSessionIdentity, PersistedDraftSession } from '@/stores/draftSessionStorage';
import type { WorkspaceCommand } from './commands';

export type DraftCommand = Exclude<WorkspaceCommand, WorkspaceCommand<`connection.${keyof import('./commands').ConnectionActions}`>> | ['moveShortlistedPlayerTo', player: string, index: number] | ['addShortlistedPlayer', player: string] | ['setPlayerShortlisted', player: string, shortlisted: boolean] | ['advanceSyncFreshness', confirmedAt: number] | ['confirmDraftSlot', position: number];

export function initialDraftState(identity: DraftSessionIdentity): DraftState {
  return {
    sessionMode: 'live', liveSession: identity,
    manualContinuityBaselineAt: null, lastConfirmedSyncAt: null, lastConfirmedPickNumber: 0,
    config: structuredClone(defaultConfig), leagueSettings: createDefaultLeagueSettings(),
    mockSettings: { ...defaultMockSettings }, mockAutoAdvance: { paused: false, settingsOpen: false },
    draftProgress: { anchor: { kind: 'start' }, historyLength: 0 }, draftHistory: [],
    shortlistedPlayerIds: [], preloadedKeepers: [], keepersInitialized: false,
    mockSurvivalProbabilities: {}, unresolvedProviderPicks: [], decisionLens: 'best-pick', filter: { ...defaultFilter },
  };
}

export function stateFromSession(session: PersistedDraftSession): DraftState {
  return { ...initialDraftState(session.identity), ...session, sessionMode: 'live', liveSession: session.identity };
}

export function sessionFromState(state: DraftState, identity: DraftSessionIdentity, revision: number, lineage: readonly string[] = []): PersistedDraftSession {
  return { version: 1, identity, revision, lineage, config: state.config, leagueSettings: state.leagueSettings,
    currentPick: deriveDraftCursor(state.draftHistory, state.draftProgress), draftProgress: state.draftProgress,
    draftHistory: state.draftHistory, shortlistedPlayerIds: state.shortlistedPlayerIds,
    preloadedKeepers: state.preloadedKeepers, keepersInitialized: state.keepersInitialized,
    unresolvedProviderPicks: state.unresolvedProviderPicks, decisionLens: state.decisionLens,
    manualContinuityBaselineAt: state.manualContinuityBaselineAt, lastConfirmedSyncAt: state.lastConfirmedSyncAt,
    lastConfirmedPickNumber: state.lastConfirmedPickNumber };
}

export function reduceDraftCommand(previous: DraftState, command: DraftCommand): { state: DraftState; result: unknown } {
  let state = previous;
  const set: SetDraftState = transition => {
    const { next, result } = runDraftTransition(state, transition);
    state = next;
    return { status: 'committed', result };
  };
  const actions: DraftActions = {
    ...createConfigurationActions(set), ...createPickActions(set), ...createProvisionalActions(set), ...createReconciliationActions(set),
    setLiveDraftSession: identity => { if (identity?.provider !== state.liveSession?.provider || identity?.draftId !== state.liveSession?.draftId) throw new Error('Open another workspace to change the durable session'); },
    ...createModeActions(set),
    setDecisionLens: lens => { set(s => { s.decisionLens = lens; }); },
    setPositionFilter: position => { set(s => { s.filter.position = position; }); },
    setSearchQuery: query => { set(s => { s.filter.searchQuery = query; }); },
  };
  if (command[0] === 'advanceSyncFreshness') {
    const confirmedAt = command[1];
    if (!Number.isFinite(confirmedAt) || confirmedAt < 0) throw new Error('Invalid sync freshness boundary');
    if (confirmedAt > (state.lastConfirmedSyncAt ?? -1)) state = { ...state, lastConfirmedSyncAt: confirmedAt };
    return { state, result: undefined };
  }
  if (command[0] === 'confirmDraftSlot') {
    actions.setConfig({ myPickPosition: command[1] });
    actions.setSessionMode('live');
    return { state, result: undefined };
  }
  const result = dispatchDraftCommand(actions, command, () => state.shortlistedPlayerIds);
  return { state, result };
}
