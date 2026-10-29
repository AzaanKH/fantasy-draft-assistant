import { DRAFT_STORAGE_MIGRATION_KEY } from '@fantasy-draft/shared/sync';
import { DraftStorageMigratedError, isDraftStorageMigrated, showDraftStorageReloadNotice } from './draftStorageMigration';
import { create, type Mutate, type StoreApi, type UseBoundStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import {
  createDraftSessionWriteId,
  getBrowserDraftSessionStorage,
  getDraftSessionStorageKey,
  parseStoredDraftSession,
  persistDraftSession,
  readStoredDraftSessionText,
  type DraftSessionIdentity,
  type DraftSessionStorage,
  type PersistedDraftSession,
} from './draftSessionStorage';
import {
  applyDraftSessionChange,
  readDraftSessionChanges,
  removeDraftSessionChange,
  type DraftSessionChange,
  type StoredDraftSessionChange,
} from './draftSessionUnconfirmedSaves';
import type { DraftStore, SetDraftState } from './draft/types';
import {
  defaultConfig,
  defaultFilter,
  defaultMockSettings,
  runDraftTransition,
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

/** Notifies the store when another tab changes a stored key, as the `storage` event does. */
type ExternalDraftSessionChanges = (
  onChange: (key: string | null, newValue: string | null) => void
) => (() => void) | undefined;

export interface DraftStoreOptions {
  readonly storage?: DraftSessionStorage | null;
  readonly session?: DraftSessionIdentity | null;
  readonly externalChanges?: ExternalDraftSessionChanges | null;
}

export function subscribeToBrowserStorageEvents(
  onChange: (key: string | null, newValue: string | null) => void
): (() => void) | undefined {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea === null || event.storageArea === getBrowserDraftSessionStorage()) {
      onChange(event.key, event.newValue);
    }
  };
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener('storage', onStorage); };
}

/** Retries before a save overwrites a tab that keeps saving first; that tab's save is then merged back. */
const MAX_SAVE_ATTEMPTS = 5;

export function createDraftStore({
  storage = null,
  session = null,
  externalChanges = null,
}: DraftStoreOptions = {}): DraftStoreApi {
  const persistence: DraftSessionPersistence = { base: EMPTY_DRAFT_SESSION_BASE };
  // Each page load records its saves under a new key, so a reloaded tab's last
  // save stays in storage for any tab to merge back if it was overwritten.
  const tabId = createDraftSessionWriteId();
  let adoptingSavedSession = false;
  let forceSave = false;
  let saveConflicted = false;
  let storageFrozen = false;
  function v1Frozen(): boolean {
    const migrated = isDraftStorageMigrated(storage);
    if (migrated && !storageFrozen) showDraftStorageReloadNotice();
    storageFrozen ||= migrated;
    return storageFrozen;
  }
  const store = create<DraftStore>()(
  immer((rawSet, get) => {
  // Every change starts from the newest saved session, so edits from other tabs are kept.
  // If another tab saves between that check and this tab's write, the change is
  // reapplied to the newer session before the action reports its result.
  const set: SetDraftState = (transition) => {
    const previousSession = get().liveSession;
    for (let attempt = 1; ; attempt += 1) {
      syncFromOtherTabs();
      const previous = get();
      const { next, result } = runDraftTransition(previous, transition);
      // Persistent contention is not expected; the overwritten save is merged back later.
      forceSave = attempt >= MAX_SAVE_ATTEMPTS;
      saveConflicted = false;
      try {
        rawSet(next, true);
      } catch (error) {
        if (!(error instanceof DraftStorageMigratedError)) throw error;
        adoptingSavedSession = true;
        try { store.setState(previous, true); } finally { adoptingSavedSession = false; }
        storageFrozen = true;
        showDraftStorageReloadNotice();
        return { status: 'refused' };
      } finally {
        forceSave = false;
      }
      if (saveConflicted) continue;
      // A newly loaded session may be missing a save overwritten before its tab reloaded.
      const { liveSession } = get();
      if (liveSession && (liveSession.provider !== previousSession?.provider ||
          liveSession.draftId !== previousSession.draftId)) syncFromOtherTabs(true);
      return { status: 'committed', result };
    }
  };
  const loadSession: SetDraftState = (transition) => {
    if (!v1Frozen()) return set(transition);
    adoptingSavedSession = true;
    try {
      const { next, result } = runDraftTransition(get(), transition);
      rawSet(next, true);
      return { status: 'committed', result };
    } finally { adoptingSavedSession = false; }
  };
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

    ...createSessionActions(set, get, storage, persistence, loadSession),
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
  store.subscribe((state, previous) => {
    if (state.liveSession !== previous.liveSession ||
        state.sessionMode !== previous.sessionMode ||
        state.config !== previous.config || state.leagueSettings !== previous.leagueSettings ||
        state.draftHistory !== previous.draftHistory ||
        state.draftProgress !== previous.draftProgress ||
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
    }
  });

  /** Returns false when another tab saved first and nothing was written. */
  function saveSession(state: DraftStore, mergedWriteIds: readonly string[] = []): boolean {
    if (storageFrozen && storage && state.liveSession && state.sessionMode !== 'mock') {
      throw new DraftStorageMigratedError();
    }
    const result = persistDraftSession(storage, state, persistence.base, { force: forceSave, tabId, mergedWriteIds });
    if (result.status === 'conflict') return false;
    if (result.status === 'written') persistence.base = result.base;
    return true;
  }

  function adoptSavedSession(saved: PersistedDraftSession, serialized: string | null): void {
    const { liveSession } = store.getState();
    if (!liveSession) return;
    persistence.base = { revision: saved.revision, serialized, lineage: saved.lineage, session: saved };
    showSession(liveSession, saved);
  }

  function showSession(liveSession: DraftSessionIdentity, session: PersistedDraftSession): void {
    adoptingSavedSession = true;
    try {
      store.setState((state) => { applySavedDraftSession(state, liveSession, session); });
    } finally {
      adoptingSavedSession = false;
    }
  }

  /**
   * Recorded saves, from any tab, that a concurrent save overwrote. A save the session
   * already includes is kept while it is the newest, since a stale save could still
   * overwrite it, and removed once a later save builds on it. Saves older than the
   * lineage are removed too: later saves built on them, so merging them again would
   * undo edits like a queue toggle. So are saves built on a session outside its
   * history, such as one that was corrupted and replaced. A save built on another
   * overwritten save is kept, since merging both restores the session it built on.
   */
  function takeOverwrittenChanges(
    liveSession: DraftSessionIdentity,
    saved: PersistedDraftSession
  ): DraftSessionChange[] {
    if (!storage) return [];
    const included = new Set(saved.lineage);
    const newestWriteId = saved.lineage.at(-1);
    const oldestCoveredRevision = saved.revision - saved.lineage.length + 1;
    let pending: StoredDraftSessionChange[] = [];
    for (const stored of readDraftSessionChanges(storage, liveSession)) {
      const { change } = stored;
      if (change.writeId === newestWriteId) continue;
      if (included.has(change.writeId) || change.revision < oldestCoveredRevision) {
        removeDraftSessionChange(storage, stored);
      } else {
        pending.push(stored);
      }
    }
    // Resolve bases through the lineage or through other overwritten saves before removing any.
    const resolved = new Set(included);
    const overwritten: DraftSessionChange[] = [];
    for (let progressed = true; progressed;) {
      const before = pending.length;
      pending = pending.filter(({ change }) => {
        if (change.baseWriteId !== null && !resolved.has(change.baseWriteId)) return true;
        resolved.add(change.writeId);
        overwritten.push(change);
        return false;
      });
      progressed = pending.length < before;
    }
    for (const stored of pending) removeDraftSessionChange(storage, stored);
    return overwritten.sort((left, right) => left.revision - right.revision);
  }

  /**
   * Adopts newer saves from other tabs and merges back any recorded save that a
   * concurrent save overwrote. Recorded saves are checked only when the stored
   * session changed, or when `checkRecordedSaves` is set after loading a session.
   */
  function syncFromOtherTabs(checkRecordedSaves = false): void {
    if (v1Frozen()) return;
    try { syncUnmigratedSession(checkRecordedSaves); } catch (error) {
      if (!(error instanceof DraftStorageMigratedError)) throw error;
      storageFrozen = true;
      showDraftStorageReloadNotice();
    }
  }

  function syncUnmigratedSession(checkRecordedSaves: boolean): void {
    // Runs inside action calls, which only happen after the store exists.
    const { liveSession, sessionMode } = store.getState();
    if (!storage || !liveSession || sessionMode === 'mock') return;
    for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
      const serialized = readStoredDraftSessionText(storage, liveSession);
      const changed = serialized !== persistence.base.serialized;
      if (!changed && !checkRecordedSaves) return;
      const saved = changed ? parseStoredDraftSession(serialized, liveSession) : persistence.base.session;
      // An unreadable entry is overwritten by the next save.
      if (!saved) return;
      if (changed) adoptSavedSession(saved, serialized);
      const overwritten = takeOverwrittenChanges(liveSession, saved);
      if (overwritten.length === 0) return;

      // A change that no longer fits the newer session, such as a pick beyond a
      // shortened draft, is dropped; the provider restores any pick it reports.
      const merged = overwritten.reduce(
        (session, change) =>
          parseStoredDraftSession(JSON.stringify(applyDraftSessionChange(session, change)), liveSession) ?? session,
        saved
      );
      showSession(liveSession, merged);
      forceSave = attempt === MAX_SAVE_ATTEMPTS;
      try {
        if (saveSession(store.getState(), overwritten.map((change) => change.writeId))) return;
      } finally {
        forceSave = false;
      }
      // Another tab saved first; merge into its session on the next pass.
      checkRecordedSaves = true;
    }
  }

  const stopExternalChanges = externalChanges?.((key, newValue) => {
    if (key === DRAFT_STORAGE_MIGRATION_KEY && newValue !== null && !storageFrozen) {
      storageFrozen = true;
      showDraftStorageReloadNotice();
    }
    if (v1Frozen()) return;
    const { liveSession } = store.getState();
    if (liveSession && (key === null || key === getDraftSessionStorageKey(liveSession))) syncFromOtherTabs();
  });
  if (session) store.getState().setLiveDraftSession(session);
  v1Frozen();
  return Object.assign(store, { dispose: () => { stopExternalChanges?.(); } });
}
