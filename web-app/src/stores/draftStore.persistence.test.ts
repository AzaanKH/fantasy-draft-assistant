import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDraftStore, type ProvisionalPickInput, type SyncedImportedPick } from './draftStore';
import {
  getDraftSessionStorageKey,
  parseStoredDraftSession,
  type DraftSessionIdentity,
} from './draftSessionStorage';
import { DRAFT_SYNC_STORAGE_KEY } from './draftSyncStore';

const identity: DraftSessionIdentity = { provider: 'sleeper', draftId: '123' };

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}

function pick(pickNumber: number, playerId: string): ProvisionalPickInput {
  return { pickNumber, playerId, playerName: playerId, position: 'WR', teamIndex: pickNumber - 1, teamName: `Team ${pickNumber}` };
}

function official(pickNumber: number, playerId: string): SyncedImportedPick {
  return { ...pick(pickNumber, playerId), isMyPick: pickNumber === 2 };
}

function openSession(storage: ReturnType<typeof memoryStorage>, session = identity) {
  const store = createDraftStore({ storage, session });
  store.getState().setSessionMode('live');
  return store;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('durable draft sessions', () => {
  it('restores the provisional journal, corrections, queue, keepers, and canonical rosters after reload', () => {
    const storage = memoryStorage();
    const first = openSession(storage);
    first.getState().setConfig({ myPickPosition: 2 });
    first.getState().preloadKeepers([{
      playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 1, round: 10, isMyKeeper: true,
    }]);
    first.getState().reconcileSyncedPicks([official(1, 'confirmed')], 2, [], 100);
    for (const id of ['observed', 'replacement', 'removed', 'waiting']) first.getState().togglePlayerShortlisted(id);
    first.getState().enterManualContinuity(100);
    first.getState().recordProvisionalPick(pick(2, 'observed'));
    first.getState().recordProvisionalPick(pick(3, 'removed'));
    const originalTimestamp = first.getState().draftHistory[1]?.timestamp;
    first.getState().correctProvisionalPick(2, pick(2, 'replacement'));
    first.getState().removeProvisionalPick(3);
    first.getState().setDecisionLens('best-player');

    const saved = storage.getItem(getDraftSessionStorageKey(identity));
    expect(saved).not.toContain('draftedPlayerIds');
    expect(saved).not.toContain('teamRosters');
    const restarted = createDraftStore({ storage, session: identity });
    const state = restarted.getState();
    expect(state.sessionMode).toBe('live');
    expect(state.manualContinuityBaselineAt).toBe(100);
    expect(state.lastConfirmedSyncAt).toBe(100);
    expect(state.lastConfirmedPickNumber).toBe(1);
    expect(state.config).toEqual(first.getState().config);
    expect(state.leagueSettings).toEqual(first.getState().leagueSettings);
    expect(state.preloadedKeepers).toEqual(first.getState().preloadedKeepers);
    expect(state.keepersInitialized).toBe(true);
    expect(state.draftHistory).toEqual(first.getState().draftHistory);
    expect(state.draftHistory[1]).toMatchObject({ source: 'provisional', playerId: 'replacement', timestamp: originalTimestamp, provisionalRevision: 1 });
    expect(state.shortlistedPlayerIds).toEqual(['observed', 'removed', 'waiting']);
    expect(state.currentPick).toBe(3);
    expect(state.draftedPlayerIds).toEqual(new Set(['confirmed', 'replacement', 'keeper']));
    expect(state.myRoster.WR).toEqual(['replacement']);
    expect(state.myRoster.RB).toEqual(['keeper']);
    expect(state.teamRosters[0]?.WR).toEqual(['confirmed']);
    expect(state.decisionLens).toBe('best-player');
    expect(restarted.getState().correctProvisionalPick(2, pick(2, 'observed'))).toBe(true);
    expect(restarted.getState().draftHistory[1]).toMatchObject({ timestamp: originalTimestamp, provisionalRevision: 2 });
    expect(restarted.getState().removeProvisionalPick(2)).toBe(true);
    const afterAnotherReload = createDraftStore({ storage, session: identity }).getState();
    expect(afterAnotherReload.draftHistory.map((entry) => entry.playerId)).toEqual(['confirmed']);
    expect(afterAnotherReload.shortlistedPlayerIds).toEqual(['observed', 'replacement', 'removed', 'waiting']);
    expect(afterAnotherReload.myRoster.WR).toEqual([]);
  });

  it('preserves restored observations until newer Provider Truth confirms, corrects, and removes them once', () => {
    const storage = memoryStorage();
    const first = openSession(storage);
    first.getState().setConfig({ myPickPosition: 2 });
    first.getState().reconcileSyncedPicks([official(1, 'confirmed')], 2, [], 100);
    for (const id of ['match', 'mistake', 'absent', 'waiting']) first.getState().togglePlayerShortlisted(id);
    first.getState().enterManualContinuity(100);
    first.getState().recordProvisionalPick(pick(2, 'match'));
    first.getState().recordProvisionalPick(pick(3, 'mistake'));
    first.getState().recordProvisionalPick(pick(4, 'absent'));
    const restarted = createDraftStore({ storage, session: identity });
    const before = restarted.getState();
    for (const timestamp of [undefined, 99, 100, NaN]) {
      expect(restarted.getState().reconcileSyncedPicks([], 1, [], timestamp).changed).toBe(false);
      expect(restarted.getState()).toBe(before);
    }
    const history = [official(1, 'confirmed'), official(2, 'match'), official(3, 'correct')];
    const result = restarted.getState().reconcileSyncedPicks(history, 4, [], 200);
    expect(result.confirmations.map((entry) => entry.playerId)).toEqual(['match']);
    expect(result.corrections.map((entry) => entry.previous.playerId)).toEqual(['mistake']);
    expect(result.removals.map((entry) => entry.playerId)).toEqual(['absent']);
    expect(restarted.getState().manualContinuityBaselineAt).toBeNull();
    expect(restarted.getState().shortlistedPlayerIds).toEqual(['absent', 'mistake', 'waiting']);
    expect(restarted.getState().draftedPlayerIds).toEqual(new Set(['confirmed', 'match', 'correct']));
    expect(restarted.getState().teamRosters[2]?.WR).toEqual(['correct']);
    expect(restarted.getState().currentPick).toBe(4);
    const afterReload = createDraftStore({ storage, session: identity });
    expect(afterReload.getState().draftHistory.every((entry) => entry.source === 'sync')).toBe(true);
    expect(afterReload.getState().lastConfirmedSyncAt).toBe(200);
    expect(afterReload.getState().reconcileSyncedPicks(history, 4, [], 200)).toMatchObject({ changed: false, confirmations: [], corrections: [], removals: [] });
    expect(afterReload.getState().reconcileSyncedPicks([], 1, [], 100).changed).toBe(false);
    expect(afterReload.getState().draftHistory).toHaveLength(3);
  });

  it('retains unresolved provider identities across restart and lets a fresh history resolve them', () => {
    const storage = memoryStorage();
    const first = openSession(storage);
    const unresolved = { pickNumber: 2, playerId: 'unknown', playerName: 'Unknown', nflTeam: null };
    first.getState().reconcileSyncedPicks([official(1, 'confirmed')], 3, [unresolved], 100);
    const restarted = createDraftStore({ storage, session: identity });
    expect(restarted.getState().unresolvedProviderPicks).toEqual([unresolved]);
    expect(restarted.getState().draftedPlayerIds.has('unknown')).toBe(false);
    expect(restarted.getState().currentPick).toBe(3);
    restarted.getState().reconcileSyncedPicks([official(1, 'confirmed'), official(2, 'resolved')], 3, [], 200);
    expect(createDraftStore({ storage, session: identity }).getState().unresolvedProviderPicks).toEqual([]);
  });

  it('isolates sessions by both provider and draft ID and archives them on disconnect', () => {
    const storage = memoryStorage();
    const store = openSession(storage);
    store.getState().togglePlayerShortlisted('sleeper-queue');
    store.getState().recordProvisionalPick(pick(1, 'sleeper-pick'));
    const otherDraft: DraftSessionIdentity = { provider: 'sleeper', draftId: '456' };
    store.getState().setLiveDraftSession(otherDraft);
    expect(store.getState().draftHistory).toEqual([]);
    expect(store.getState().shortlistedPlayerIds).toEqual([]);
    expect(store.getState().draftedPlayerIds.size).toBe(0);
    store.getState().togglePlayerShortlisted('other-draft-queue');
    const otherProvider: DraftSessionIdentity = { provider: 'espn', draftId: '123' };
    store.getState().setLiveDraftSession(otherProvider);
    store.getState().togglePlayerShortlisted('espn-queue');
    store.getState().setLiveDraftSession(identity);
    expect(store.getState().draftHistory[0]?.playerId).toBe('sleeper-pick');
    expect(store.getState().shortlistedPlayerIds).toEqual(['sleeper-queue']);
    const writes = storage.setItem.mock.calls.length;
    store.getState().setLiveDraftSession(identity);
    expect(storage.setItem).toHaveBeenCalledTimes(writes);
    store.getState().setLiveDraftSession(null);
    store.getState().resetDraft();
    expect(store.getState().draftHistory).toEqual([]);
    expect(createDraftStore({ storage, session: identity }).getState().draftHistory).toHaveLength(1);
    expect(createDraftStore({ storage, session: otherDraft }).getState().shortlistedPlayerIds).toEqual(['other-draft-queue']);
    expect(createDraftStore({ storage, session: otherProvider }).getState().shortlistedPlayerIds).toEqual(['espn-queue']);
  });

  it('persists queue removals and an explicit reset without reviving old provisional picks', () => {
    const storage = memoryStorage();
    const store = openSession(storage);
    store.getState().togglePlayerShortlisted('first');
    store.getState().togglePlayerShortlisted('second');
    store.getState().removePlayerFromShortlist('first');
    expect(createDraftStore({ storage, session: identity }).getState().shortlistedPlayerIds).toEqual(['second']);
    store.getState().enterManualContinuity(100);
    store.getState().recordProvisionalPick(pick(1, 'observed'));
    store.getState().resetDraft();
    const restarted = createDraftStore({ storage, session: identity }).getState();
    expect(restarted.draftHistory).toEqual([]);
    expect(restarted.shortlistedPlayerIds).toEqual([]);
    expect(restarted.manualContinuityBaselineAt).toBeNull();
    expect(restarted.currentPick).toBe(1);
  });

  it('keeps mocks, unbound stores, and transient calculations from overwriting a live journal', () => {
    const storage = memoryStorage();
    const store = openSession(storage);
    store.getState().togglePlayerShortlisted('saved');
    const saved = storage.getItem(getDraftSessionStorageKey(identity));
    const writes = storage.setItem.mock.calls.length;
    store.getState().setPositionFilter('QB');
    store.getState().setSearchQuery('search');
    store.getState().setMockSurvivalProbabilities({ saved: 0.5 });
    expect(storage.setItem).toHaveBeenCalledTimes(writes);
    store.getState().setSessionMode('mock');
    store.getState().markPlayerDrafted('cpu', 'CPU', 'QB', 0, 'Team 1', 1, 'cpu');
    store.getState().resetDraft();
    store.getState().setSessionMode('setup');
    store.getState().togglePlayerShortlisted('mock-queue');
    expect(storage.getItem(getDraftSessionStorageKey(identity))).toBe(saved);
    const isolated = createDraftStore({ storage });
    isolated.getState().togglePlayerShortlisted('isolated');
    expect(storage.getItem(getDraftSessionStorageKey(identity))).toBe(saved);
    expect(createDraftStore({ storage, session: identity }).getState().shortlistedPlayerIds).toEqual(['saved']);
  });

  it('continues in memory when storage reads or writes fail', () => {
    const storage = {
      getItem: () => { throw new Error('Blocked'); },
      setItem: () => { throw new Error('Full'); },
    };
    const store = createDraftStore({ storage, session: identity });
    store.getState().setSessionMode('live');
    expect(() => { store.getState().togglePlayerShortlisted('queued'); }).not.toThrow();
    expect(store.getState().recordProvisionalPick(pick(1, 'observed'))).toBe(true);
    expect(store.getState().draftHistory).toHaveLength(1);
    expect(store.getState().shortlistedPlayerIds).toEqual(['queued']);
  });

  it('applies a stale tab’s change on top of another tab’s outage picks, queue, and baseline', () => {
    const storage = memoryStorage();
    const tabA = openSession(storage);
    tabA.getState().setConfig({ myPickPosition: 2 });
    tabA.getState().preloadKeepers([]);
    const tabB = openSession(storage);
    tabA.getState().reconcileSyncedPicks([official(1, 'confirmed')], 2, [], 100);
    tabA.getState().togglePlayerShortlisted('queued');
    tabA.getState().enterManualContinuity(100);
    expect(tabA.getState().recordProvisionalPick(pick(2, 'observed'))).toBe(true);

    // Tab B never saw A's writes and now changes only its decision lens.
    tabB.getState().setDecisionLens('best-player');

    // B applies its change on top of A's newer session instead of writing over it.
    for (const state of [tabB.getState(), createDraftStore({ storage, session: identity }).getState()]) {
      expect(state.draftHistory.map((entry) => entry.playerId)).toEqual(['confirmed', 'observed']);
      expect(state.shortlistedPlayerIds).toEqual(['queued']);
      expect(state.manualContinuityBaselineAt).toBe(100);
      expect(state.decisionLens).toBe('best-player');
    }
  });

  it('applies other tabs’ saves as they happen so later edits build on them', () => {
    const values = new Map<string, string>();
    const listeners: ((key: string | null, newValue: string | null) => void)[] = [];
    // Mirrors the storage event: every other tab hears a write, the writer does not.
    function tab() {
      let self: ((key: string | null, newValue: string | null) => void) | null = null;
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
          for (const listener of listeners) if (listener !== self) listener(key, value);
        },
      };
      const store = createDraftStore({
        storage,
        session: identity,
        externalChanges: (onChange) => { self = onChange; listeners.push(onChange); },
      });
      store.getState().setSessionMode('live');
      return store;
    }
    const tabA = tab();
    const tabB = tab();

    tabA.getState().recordProvisionalPick(pick(1, 'observed'));
    expect(tabB.getState().draftHistory.map((entry) => entry.playerId)).toEqual(['observed']);
    expect(tabB.getState().draftedPlayerIds.has('observed')).toBe(true);

    tabB.getState().setDecisionLens('best-player');
    expect(tabA.getState().decisionLens).toBe('best-player');
    const saved = parseStoredDraftSession(values.get(getDraftSessionStorageKey(identity)) ?? null, identity);
    expect(saved?.draftHistory.map((entry) => entry.playerId)).toEqual(['observed']);
    expect(saved?.decisionLens).toBe('best-player');
  });

  it('reapplies a pick when another tab saves between the pre-change check and the write', () => {
    const storage = memoryStorage();
    const key = getDraftSessionStorageKey(identity);
    let racingReads: number | null = null;
    const tabA = openSession({
      ...storage,
      getItem: vi.fn((storedKey: string) => {
        // Read 1 is A's pre-change check; before read 2, A's save, tab B saves.
        if (racingReads !== null && storedKey === key && (racingReads += 1) === 2) {
          tabB.getState().setDecisionLens('best-player');
        }
        return storage.getItem(storedKey);
      }),
    });
    const tabB = openSession(storage);
    racingReads = 0;

    expect(tabA.getState().recordProvisionalPick(pick(1, 'observed'))).toBe(true);

    for (const state of [tabA.getState(), createDraftStore({ storage, session: identity }).getState()]) {
      expect(state.draftHistory.map((entry) => entry.playerId)).toEqual(['observed']);
      expect(state.decisionLens).toBe('best-player');
    }
  });

  it('reapplies a save that a concurrent tab overwrote from a stale read', () => {
    const storage = memoryStorage();
    const key = getDraftSessionStorageKey(identity);
    let staleRead: string | null = null;
    const tabA = openSession(storage);
    // Tab B reads before tab A's save lands, as when both tabs save at once.
    const tabB = openSession({
      ...storage,
      getItem: vi.fn((storedKey: string) => storedKey === key && staleRead !== null ? staleRead : storage.getItem(storedKey)),
    });
    staleRead = storage.getItem(key);

    expect(tabA.getState().recordProvisionalPick(pick(1, 'observed'))).toBe(true);
    tabB.getState().setDecisionLens('best-player');
    expect(parseStoredDraftSession(storage.getItem(key), identity)?.draftHistory).toEqual([]);

    // A's next check finds its save missing from B's lineage and reapplies the pick.
    tabA.getState().togglePlayerShortlisted('queued');
    for (const state of [tabA.getState(), createDraftStore({ storage, session: identity }).getState()]) {
      expect(state.draftHistory.map((entry) => entry.playerId)).toEqual(['observed']);
      expect(state.decisionLens).toBe('best-player');
      expect(state.shortlistedPlayerIds).toEqual(['queued']);
    }
  });

  it('restores the draft type and treats sessions saved before draft types as snake drafts', () => {
    const storage = memoryStorage();
    const store = openSession(storage);
    store.getState().setConfig({ draftType: 'linear' });
    store.getState().recordProvisionalPick(pick(1, 'observed'));
    const serialized = storage.getItem(getDraftSessionStorageKey(identity));
    if (!serialized) throw new Error('Missing snapshot');
    expect(parseStoredDraftSession(serialized, identity)?.config.draftType).toBe('linear');

    const snapshot = JSON.parse(serialized) as { config: Record<string, unknown> };
    const { draftType: _removed, ...legacyConfig } = snapshot.config;
    expect(parseStoredDraftSession(JSON.stringify({ ...snapshot, config: legacyConfig }), identity)?.config.draftType).toBe('snake');
    expect(parseStoredDraftSession(JSON.stringify({ ...snapshot, config: { ...snapshot.config, draftType: 'keeper' } }), identity)).toBeNull();
  });

  it('rejects corrupt, unsupported, mismatched, and unbounded snapshots before rebuilding state', () => {
    const storage = memoryStorage();
    const store = openSession(storage);
    store.getState().recordProvisionalPick(pick(1, 'observed'));
    const serialized = storage.getItem(getDraftSessionStorageKey(identity));
    if (!serialized) throw new Error('Missing snapshot');
    const snapshot = JSON.parse(serialized) as Record<string, unknown>;
    for (const invalid of [
      '{', JSON.stringify({ ...snapshot, version: 2 }),
      JSON.stringify({ ...snapshot, identity: { provider: 'yahoo', draftId: '123' } }),
      JSON.stringify({ ...snapshot, config: { ...store.getState().config, totalTeams: 2 ** 32 } }),
      JSON.stringify({ ...snapshot, currentPick: -1 }),
      JSON.stringify({ ...snapshot, draftHistory: [{ ...pick(1, 'invalid'), position: '__proto__', source: 'provisional', timestamp: 100 }] }),
      JSON.stringify({ ...snapshot, draftHistory: [store.getState().draftHistory[0], store.getState().draftHistory[0]] }),
      JSON.stringify({ ...snapshot, preloadedKeepers: [{ playerId: 'bad', round: 1, teamIndex: 2 ** 32 }] }),
    ]) expect(parseStoredDraftSession(invalid, identity)).toBeNull();
    storage.setItem(getDraftSessionStorageKey(identity), '{');
    expect(() => createDraftStore({ storage, session: identity })).not.toThrow();
    expect(createDraftStore({ storage, session: identity }).getState().draftHistory).toEqual([]);
  });

  it('hydrates the default store before rendering and follows saved and URL connection changes synchronously', async () => {
    vi.resetModules();
    const storage = memoryStorage();
    const store = openSession(storage);
    store.getState().enterManualContinuity(100);
    store.getState().recordProvisionalPick(pick(1, 'saved-pick'));
    storage.setItem(DRAFT_SYNC_STORAGE_KEY, JSON.stringify({ ...identity, draftPosition: 2 }));
    vi.stubGlobal('window', { localStorage: storage });
    const { useDraftStore } = await import('./draftStore');
    const { useDraftSyncConnectionStore, initializeDraftSyncConnection } = await import('./draftSyncStore');
    expect(useDraftStore.getState().draftHistory[0]?.playerId).toBe('saved-pick');
    expect(useDraftStore.getState().manualContinuityBaselineAt).toBe(100);
    initializeDraftSyncConnection('?provider=espn&draftId=123&position=1');
    expect(useDraftStore.getState().liveSession).toEqual({ provider: 'espn', draftId: '123' });
    expect(useDraftStore.getState().draftHistory).toEqual([]);
    useDraftSyncConnectionStore.getState().startConnection('sleeper', '123');
    expect(useDraftStore.getState().draftHistory[0]?.playerId).toBe('saved-pick');
    useDraftSyncConnectionStore.getState().disconnect();
    expect(useDraftStore.getState().liveSession).toBeNull();
    expect(useDraftStore.getState().draftHistory).toEqual([]);
  });
});
