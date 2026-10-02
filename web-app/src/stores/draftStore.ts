import { createContext, createElement, useContext, type ReactNode, type ReactElement } from 'react';
import { create, useStore, type Mutate, type StoreApi, type UseBoundStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared';
import { useDraftSyncConnectionStore } from './draftSyncStore';
import {
  DRAFT_SESSION_LINEAGE_LIMIT,
  getBrowserDraftSessionStorage,
  getDraftSessionStorageKey,
  parseStoredDraftSession,
  persistDraftSession,
  readStoredDraftSessionText,
  type DraftSessionIdentity,
  type DraftSessionStorage,
  type PersistedDraftSession,
} from './draftSessionStorage';
import type { DraftStore, DraftSessionMode, SetDraftState } from './draft/types';
import {
  calculateIsMyTurn,
  createEmptyMutableRoster,
  createEmptyTeamRosters,
  defaultConfig,
  defaultFilter,
  defaultMockSettings,
} from './draft/state';
import {
  applySavedDraftSession,
  createSessionActions,
  EMPTY_DRAFT_SESSION_BASE,
  type DraftSessionPersistence,
} from './draft/session-actions';
import { createConfigurationActions } from './draft/configuration-actions';
import { createProvisionalActions } from './draft/provisional-actions';
import { createPickActions } from './draft/pick-actions';
import { createReconciliationActions } from './draft/reconciliation';

export type {
  DraftStore,
  DraftConfig,
  MockDraftSettings,
  DraftSessionMode,
  DraftTeamRoster,
  RecordedDraftPick,
  ProvisionalPickInput,
  SyncedImportedPick,
  ReconciledDraftPick,
  ProvisionalPickConfirmation,
  DraftPickCorrection,
  DraftPickRemoval,
  UnresolvedProviderPick,
  DraftReconciliationResult,
  PreloadedKeeper,
} from './draft/types';
export { calculateIsMyTurn } from './draft/state';

enableMapSet();

type BoundDraftStore = UseBoundStore<Mutate<StoreApi<DraftStore>, [['zustand/immer', never]]>>;
export type DraftStoreApi = BoundDraftStore;

/** Notifies the store when another tab changes a stored key, as the `storage` event does. */
export type ExternalDraftSessionChanges = (
  onChange: (key: string | null, newValue: string | null) => void
) => void;

interface DraftStoreOptions {
  readonly storage?: DraftSessionStorage | null;
  readonly session?: DraftSessionIdentity | null;
  readonly externalChanges?: ExternalDraftSessionChanges | null;
}

function subscribeToBrowserStorageEvents(
  onChange: (key: string | null, newValue: string | null) => void
): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('storage', (event) => {
    if (event.storageArea === null || event.storageArea === getBrowserDraftSessionStorage()) {
      onChange(event.key, event.newValue);
    }
  });
}

type DraftTransition = Parameters<SetDraftState>[0];

/** Retries before a save overwrites a tab that keeps saving first; that tab then reapplies its write. */
const MAX_SAVE_ATTEMPTS = 5;

/**
 * Create the draft store with Zustand + immer for immutable updates
 */
export function createDraftStore({
  storage = null,
  session = null,
  externalChanges = null,
}: DraftStoreOptions = {}): BoundDraftStore {
  const persistence: DraftSessionPersistence = { base: EMPTY_DRAFT_SESSION_BASE };
  // This tab's saves not yet built on by another tab. One missing from the stored
  // lineage was overwritten by a concurrent save, so its changes are reapplied.
  let unconfirmedWrites: { readonly writeId: string; readonly transitions: readonly DraftTransition[] }[] = [];
  let adoptingSavedSession = false;
  let pendingTransitions: readonly DraftTransition[] = [];
  let forceSave = false;
  let saveConflicted = false;
  const store = create<DraftStore>()(
  immer((rawSet, get) => {
  // Every change starts from the newest saved session, so edits from other tabs are kept.
  // If another tab saves between that check and this tab's write, the change is
  // reapplied to the newer session before the action reports its result.
  const set: SetDraftState = (transition) => {
    for (let attempt = 1; ; attempt += 1) {
      syncFromOtherTabs();
      pendingTransitions = [transition];
      // Persistent contention is not expected; the overwritten tab reapplies its own write.
      forceSave = attempt >= MAX_SAVE_ATTEMPTS;
      saveConflicted = false;
      try {
        rawSet(transition);
      } finally {
        pendingTransitions = [];
        forceSave = false;
      }
      if (!saveConflicted) return;
    }
  };
  return {
    // Initial state
    sessionMode: 'setup',
    liveSession: null,
    manualContinuityBaselineAt: null,
    lastConfirmedSyncAt: null,
    lastConfirmedPickNumber: 0,
    config: defaultConfig,
    leagueSettings: createDefaultLeagueSettings(),
    mockSettings: defaultMockSettings,
    currentPick: 1,
    draftedPlayerIds: new Set<string>(),
    draftHistory: [],
    shortlistedPlayerIds: [],
    preloadedKeepers: [],
    keepersInitialized: false,
    mockSurvivalProbabilities: {},
    unresolvedProviderPicks: [],
    myRoster: createEmptyMutableRoster(),
    teamRosters: createEmptyTeamRosters(defaultConfig.totalTeams),
    decisionLens: 'best-pick',
    filter: defaultFilter,

    // Computed getters
    get isMyTurn() {
      const state = get();
      return calculateIsMyTurn(
        state.currentPick,
        state.config.myPickPosition,
        state.config.totalTeams,
        state.config.draftType
      );
    },
    get totalPicks() {
      const state = get();
      return state.config.totalTeams * state.config.totalRounds;
    },

    ...createSessionActions(set, get, storage, persistence),
    ...createConfigurationActions(set),
    ...createProvisionalActions(set),
    ...createPickActions(set),
    ...createReconciliationActions(set),
    // UI actions
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
  // Derived Sets and rosters are rebuilt on hydration, never deserialized.
  store.subscribe((state, previous) => {
    if (state.liveSession !== previous.liveSession ||
        state.sessionMode !== previous.sessionMode ||
        state.config !== previous.config || state.leagueSettings !== previous.leagueSettings ||
        state.currentPick !== previous.currentPick || state.draftHistory !== previous.draftHistory ||
        state.shortlistedPlayerIds !== previous.shortlistedPlayerIds ||
        state.preloadedKeepers !== previous.preloadedKeepers || state.keepersInitialized !== previous.keepersInitialized ||
        state.unresolvedProviderPicks !== previous.unresolvedProviderPicks ||
        state.decisionLens !== previous.decisionLens ||
        state.manualContinuityBaselineAt !== previous.manualContinuityBaselineAt ||
        state.lastConfirmedSyncAt !== previous.lastConfirmedSyncAt ||
        state.lastConfirmedPickNumber !== previous.lastConfirmedPickNumber) {
      if (adoptingSavedSession) return;
      const sessionChanged = state.liveSession !== previous.liveSession;
      if (!saveSession(state) && !sessionChanged) saveConflicted = true;
      // Loading a session starts a new lineage; replaying the load would discard newer saves.
      if (sessionChanged) unconfirmedWrites = [];
    }
  });

  /** Returns false when another tab saved first and nothing was written. */
  function saveSession(state: DraftStore): boolean {
    const result = persistDraftSession(storage, state, persistence.base, forceSave);
    if (result.status === 'conflict') return false;
    if (result.status === 'written') {
      persistence.base = result.base;
      unconfirmedWrites = [
        ...unconfirmedWrites,
        { writeId: result.writeId, transitions: pendingTransitions },
      ].slice(-DRAFT_SESSION_LINEAGE_LIMIT);
    }
    return true;
  }

  function adoptSavedSession(saved: PersistedDraftSession, serialized: string | null): void {
    const { liveSession } = store.getState();
    if (!liveSession) return;
    persistence.base = { revision: saved.revision, serialized, lineage: saved.lineage };
    adoptingSavedSession = true;
    try {
      store.setState((state) => { applySavedDraftSession(state, liveSession, saved); });
    } finally {
      adoptingSavedSession = false;
    }
  }

  function syncFromOtherTabs(): void {
    // Runs inside action calls, which only happen after the store exists.
    const { liveSession, sessionMode } = store.getState();
    if (!storage || !liveSession || sessionMode === 'mock') return;
    for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
      const serialized = readStoredDraftSessionText(storage, liveSession);
      if (serialized === persistence.base.serialized) return;
      const saved = parseStoredDraftSession(serialized, liveSession);
      // An unreadable entry is overwritten by the next save.
      if (!saved) return;
      const builtOn = new Set(saved.lineage);
      const overwritten = unconfirmedWrites.filter((write) => !builtOn.has(write.writeId));
      unconfirmedWrites = overwritten;
      adoptSavedSession(saved, serialized);
      if (overwritten.length === 0) return;

      // Another tab saved concurrently over this tab's writes; reapply them to its session.
      const transitions = overwritten.flatMap((write) => write.transitions);
      adoptingSavedSession = true;
      try {
        for (const transition of transitions) store.setState(transition);
      } finally {
        adoptingSavedSession = false;
      }
      unconfirmedWrites = [];
      pendingTransitions = transitions;
      forceSave = attempt === MAX_SAVE_ATTEMPTS;
      try {
        if (saveSession(store.getState())) return;
        // Never written, so the next pass reapplies these changes again.
        unconfirmedWrites = [{ writeId: '', transitions }];
      } finally {
        pendingTransitions = [];
        forceSave = false;
      }
    }
  }

  externalChanges?.((key) => {
    const { liveSession } = store.getState();
    if (liveSession && (key === null || key === getDraftSessionStorageKey(liveSession))) syncFromOtherTabs();
  });
  if (session) store.getState().setLiveDraftSession(session);
  return store;
}

const defaultDraftStore = createDraftStore({
  storage: getBrowserDraftSessionStorage(),
  session: useDraftSyncConnectionStore.getState().connection,
  externalChanges: subscribeToBrowserStorageEvents,
});
// Connection changes bind and hydrate synchronously, before React's sync effects.
// Explicitly created stores remain isolated for mocks, rehearsals, and tests.
useDraftSyncConnectionStore.subscribe(({ connection }) => {
  defaultDraftStore.getState().setLiveDraftSession(connection);
});
const DraftStoreContext = createContext<DraftStoreApi | null>(null);

export function DraftStoreProvider({
  children,
  store,
}: {
  readonly children: ReactNode;
  readonly store: DraftStoreApi;
}): ReactElement {
  return createElement(DraftStoreContext.Provider, { value: store }, children);
}

export function useDraftStoreApi(): DraftStoreApi {
  return useContext(DraftStoreContext) ?? defaultDraftStore;
}

interface UseDraftStore {
  <T>(selector: (state: DraftStore) => T): T;
  readonly getState: DraftStoreApi['getState'];
  readonly getInitialState: DraftStoreApi['getInitialState'];
  readonly setState: DraftStoreApi['setState'];
  readonly subscribe: DraftStoreApi['subscribe'];
}

function useDraftStoreSelector<T>(selector: (state: DraftStore) => T): T {
  return useStore(useDraftStoreApi(), selector);
}

// Static methods address the default store. Components must capture useDraftStoreApi()
// during render for imperative callbacks scoped to a DraftStoreProvider.
export const useDraftStore: UseDraftStore = Object.assign(
  useDraftStoreSelector,
  {
    getState: defaultDraftStore.getState.bind(defaultDraftStore),
    getInitialState: defaultDraftStore.getInitialState.bind(defaultDraftStore),
    setState: defaultDraftStore.setState.bind(defaultDraftStore),
    subscribe: defaultDraftStore.subscribe.bind(defaultDraftStore),
  }
);

/**
 * Selector hooks for common state slices
 */
export const useDraftSessionMode = (): DraftSessionMode =>
  useDraftStore((state) => state.sessionMode);
export const useIsMyTurn = () =>
  useDraftStore((state) =>
    calculateIsMyTurn(
      state.currentPick,
      state.config.myPickPosition,
      state.config.totalTeams,
      state.config.draftType
    )
  );
