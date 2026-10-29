import { DRAFT_STORAGE_MIGRATION_KEY, isDraftSessionIdentity } from '@fantasy-draft/shared/sync';
import { DraftStorageMigratedError, isDraftStorageMigrated, showDraftStorageReloadNotice } from './draftStorageMigration';
import { create, type Mutate, type StoreApi, type UseBoundStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import {
  createDraftSessionWriteId,
  EMPTY_DRAFT_SESSION_BASE,
  getBrowserDraftSessionStorage,
  getDraftSessionStorageKey,
  parseStoredDraftSession,
  persistDraftSession,
  readStoredDraftSessionText,
  type DraftSessionBase,
  type DraftSessionIdentity,
  type DraftSessionStorage,
  type PersistedDraftSession,
} from './draftSessionStorage';
import { applyDraftSessionChange, takeOverwrittenSaves } from './draftSessionUnconfirmedSaves';
import type { DraftState, DraftStore, DraftTransition, SetDraftState } from './draft/types';
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

/** Fields whose change is written to the stored session. */
const STORED_FIELDS = [
  'liveSession',
  'sessionMode',
  'config',
  'leagueSettings',
  'draftHistory',
  'draftProgress',
  'shortlistedPlayerIds',
  'preloadedKeepers',
  'keepersInitialized',
  'unresolvedProviderPicks',
  'decisionLens',
  'manualContinuityBaselineAt',
  'lastConfirmedSyncAt',
  'lastConfirmedPickNumber',
] as const satisfies readonly (keyof DraftState)[];

function changesStoredSession(previous: DraftState, next: DraftState): boolean {
  return STORED_FIELDS.some((field) => previous[field] !== next[field]);
}

/**
 * localStorage has no compare-and-set, so a tab that keeps losing the race to
 * save would never write. Its final attempt overwrites the newer save instead,
 * and that save is merged back from its recorded change.
 */
const MAX_SAVE_ATTEMPTS = 5;

interface SaveAttempt {
  readonly final: boolean;
}

/** `conflict`: another tab saved first and nothing was written. `refused`: draft storage has migrated. */
type SaveOutcome = 'saved' | 'conflict' | 'refused';

export function createDraftStore({
  storage = null,
  session = null,
  externalChanges = null,
}: DraftStoreOptions = {}): DraftStoreApi {
  let base: DraftSessionBase = EMPTY_DRAFT_SESSION_BASE;
  // A reloaded tab gets a new ID, so its last recorded save stays in storage for any tab to merge back.
  const tabId = createDraftSessionWriteId();
  let storageFrozen = false;
  function v1Frozen(): boolean {
    const migrated = isDraftStorageMigrated(storage);
    if (migrated && !storageFrozen) showDraftStorageReloadNotice();
    storageFrozen ||= migrated;
    return storageFrozen;
  }
  function freezeStorage(): void {
    storageFrozen = true;
    showDraftStorageReloadNotice();
  }
  let stopExternalChanges: (() => void) | undefined;

  const store = create<DraftStore>()(
  immer((rawSet, get, api) => {
  const show = (next: DraftStore): void => { rawSet(next, true); };

  function saveSession(state: DraftStore, attempt: SaveAttempt, mergedWriteIds: readonly string[] = []): SaveOutcome {
    if (storageFrozen && storage && state.liveSession && state.sessionMode !== 'mock') {
      throw new DraftStorageMigratedError();
    }
    const result = persistDraftSession(storage, state, base, { force: attempt.final, tabId, mergedWriteIds });
    if (result.status === 'conflict') return 'conflict';
    if (result.status === 'written') base = result.base;
    return 'saved';
  }

  function saveChange(previous: DraftStore, next: DraftStore, attempt: SaveAttempt): SaveOutcome {
    if (!changesStoredSession(previous, next)) return 'saved';
    try {
      return saveSession(next, attempt);
    } catch (error) {
      if (!(error instanceof DraftStorageMigratedError)) throw error;
      freezeStorage();
      return 'refused';
    }
  }

  function showSavedSession(liveSession: DraftSessionIdentity, saved: PersistedDraftSession): void {
    rawSet((state) => { applySavedDraftSession(state, liveSession, saved); });
  }

  /** Adopts a newer save from another tab, then merges back recorded saves that a concurrent save overwrote. */
  function mergeNewerSaves(
    storage: DraftSessionStorage,
    liveSession: DraftSessionIdentity,
    checkRecordedSaves: boolean,
    attempt: SaveAttempt
  ): SaveOutcome {
    const serialized = readStoredDraftSessionText(storage, liveSession);
    const changed = serialized !== base.serialized;
    if (!changed && !checkRecordedSaves) return 'saved';
    const saved = changed ? parseStoredDraftSession(serialized, liveSession) : base.session;
    // An unreadable entry is overwritten by the next save.
    if (!saved) return 'saved';
    if (changed) {
      base = { revision: saved.revision, serialized, lineage: saved.lineage, session: saved };
      showSavedSession(liveSession, saved);
    }
    const overwritten = takeOverwrittenSaves(storage, liveSession, saved);
    if (overwritten.length === 0) return 'saved';

    // A change that no longer fits the newer session, such as a pick beyond a
    // shortened draft, is dropped; the provider restores any pick it reports.
    const merged = overwritten.reduce(
      (session, change) =>
        parseStoredDraftSession(JSON.stringify(applyDraftSessionChange(session, change)), liveSession) ?? session,
      saved
    );
    showSavedSession(liveSession, merged);
    return saveSession(get(), attempt, overwritten.map((change) => change.writeId));
  }

  /** `checkRecordedSaves` merges overwritten saves even when the stored session is unchanged. */
  function syncFromOtherTabs(checkRecordedSaves = false): void {
    if (v1Frozen()) return;
    const { liveSession, sessionMode } = get();
    if (!storage || !liveSession || sessionMode === 'mock') return;
    try {
      for (let attempt = 1; ; attempt += 1) {
        const outcome = mergeNewerSaves(storage, liveSession, checkRecordedSaves, { final: attempt === MAX_SAVE_ATTEMPTS });
        if (outcome !== 'conflict') return;
      }
    } catch (error) {
      if (!(error instanceof DraftStorageMigratedError)) throw error;
      freezeStorage();
    }
  }

  const set: SetDraftState = (transition) => {
    for (let attempt = 1; ; attempt += 1) {
      syncFromOtherTabs();
      const previous = get();
      const { next, result } = runDraftTransition(previous, transition);
      const outcome = saveChange(previous, next, { final: attempt === MAX_SAVE_ATTEMPTS });
      if (outcome === 'refused') return { status: 'refused' };
      if (outcome === 'saved') {
        show(next);
        return { status: 'committed', result };
      }
    }
  };

  function openSession(identity: DraftSessionIdentity | null): void {
    const serialized = identity ? readStoredDraftSessionText(storage, identity) : null;
    const saved = identity ? parseStoredDraftSession(serialized, identity) : null;
    const savedBase = saved
      ? { revision: saved.revision, serialized, lineage: saved.lineage, session: saved }
      : EMPTY_DRAFT_SESSION_BASE;
    const open: DraftTransition<void> = (state) => {
      applySavedDraftSession(state, identity, saved);
      state.filter = { ...defaultFilter };
    };
    if (v1Frozen()) {
      base = savedBase;
      show(runDraftTransition(get(), open).next);
      return;
    }
    syncFromOtherTabs();
    const previous = get();
    const { next } = runDraftTransition(previous, open);
    base = savedBase;
    if (saveChange(previous, next, { final: false }) === 'refused') return;
    show(next);
    // A save overwritten just before its tab reloaded survives only as a recorded change.
    if (identity) syncFromOtherTabs(true);
  }

  const applyState = api.setState.bind(api);
  api.setState = (...args: unknown[]) => {
    const previous = get();
    Reflect.apply(applyState, undefined, args);
    const next = get();
    if (changesStoredSession(previous, next)) saveSession(next, { final: false });
  };

  stopExternalChanges = externalChanges?.((key, newValue) => {
    if (key === DRAFT_STORAGE_MIGRATION_KEY && newValue !== null && !storageFrozen) freezeStorage();
    if (v1Frozen()) return;
    const { liveSession } = get();
    if (liveSession && (key === null || key === getDraftSessionStorageKey(liveSession))) syncFromOtherTabs();
  });

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
  v1Frozen();
  return Object.assign(store, { dispose: () => { stopExternalChanges?.(); } });
}
