import { isDraftSessionIdentity } from '@fantasy-draft/shared/sync';
import { create, type Mutate, type StoreApi, type UseBoundStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import type { DraftSessionIdentity } from './draftSessionStorage';
import type { DraftStore, DraftTransition, SetDraftState } from './draft/types';
import {
  defaultConfig,
  defaultFilter,
  defaultMockSettings,
  runDraftTransition,
} from './draft/state';
import { applySavedDraftSession } from './draft/saved-session';
import { createModeActions } from './draft/mode-actions';
import { createConfigurationActions } from './draft/configuration-actions';
import { createProvisionalActions } from './draft/provisional-actions';
import { createPickActions } from './draft/pick-actions';
import { createReconciliationActions } from './draft/reconciliation';

export type {
  DraftSessionMode,
  MockCpuPickPace,
  DraftTeamRoster,
  RecordedDraftPick,
  ProvisionalPickInput,
  SyncedImportedPick,
  UnresolvedProviderPick,
  PreloadedKeeper,
} from './draft/types';

enableMapSet();

type BoundDraftStore = UseBoundStore<Mutate<StoreApi<DraftStore>, [['zustand/immer', never]]>>;
export type DraftStoreApi = BoundDraftStore & { readonly dispose: () => void };

export interface DraftStoreOptions {
  readonly session?: DraftSessionIdentity | null;
}

/** The in-memory draft state. Saving belongs to the workspace that owns the store, not to the store. */
export function createDraftStore({ session = null }: DraftStoreOptions = {}): DraftStoreApi {
  const store = create<DraftStore>()(
  immer((rawSet, get) => {
  const set: SetDraftState = (transition) => {
    const { next, result } = runDraftTransition(get(), transition);
    rawSet(next, true);
    return { status: 'committed', result };
  };

  function openSession(identity: DraftSessionIdentity | null): void {
    const open: DraftTransition<void> = (state) => {
      applySavedDraftSession(state, identity, null);
      state.filter = { ...defaultFilter };
    };
    rawSet(runDraftTransition(get(), open).next, true);
  }

  return {
    sessionMode: 'setup',
    liveSession: null,
    manualContinuityBaselineAt: null,
    lastConfirmedSyncAt: null,
    lastConfirmedPickNumber: 0,
    config: defaultConfig,
    leagueSettings: createDefaultLeagueSettings(),
    mockSettings: defaultMockSettings,
    mockAutoAdvance: { paused: false, settingsOpen: false },
    draftProgress: { anchor: { kind: 'start' }, historyLength: 0 },
    draftHistory: [],
    shortlistedPlayerIds: [],
    preloadedKeepers: [],
    keepersInitialized: false,
    mockSurvivalProbabilities: {},
    unresolvedProviderPicks: [],
    decisionLens: 'best-pick',
    filter: defaultFilter,

    ...createModeActions(set),
    setLiveDraftSession: (identity) => {
      if (identity !== null && !isDraftSessionIdentity(identity)) return;
      const current = get().liveSession;
      if (current?.provider === identity?.provider && current?.draftId === identity?.draftId) return;
      openSession(identity);
    },
    ...createConfigurationActions(set),
    ...createProvisionalActions(set),
    ...createPickActions(set),
    ...createReconciliationActions(set),
    setDecisionLens: (lens) =>
      { set((state) => {
        state.decisionLens = lens;
      }); },

    setPositionFilter: (position) =>
      { set((state) => {
        state.filter.position = position;
      }); },

    setSearchQuery: (query) =>
      { set((state) => {
        state.filter.searchQuery = query;
      }); },

  };
  })
  );
  if (session) store.getState().setLiveDraftSession(session);
  return Object.assign(store, { dispose: () => undefined });
}
