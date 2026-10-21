import '@/stores/draft/derive-shadow.setup';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { deriveDraftCursor } from '@fantasy-draft/shared/draft';
import { createDraftStore } from './draftStore';
import { getDraftSessionStorageKey, parseStoredDraftSession, persistDraftSession } from './draftSessionStorage';
import { defaultConfig } from './draft/state';
import { EMPTY_DRAFT_SESSION_BASE } from './draft/session-actions';

const identity = { provider: 'sleeper', draftId: '123' } as const;
const key = getDraftSessionStorageKey(identity);
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}
function open(storage: ReturnType<typeof memoryStorage>) {
  const store = createDraftStore({ storage, session: identity });
  store.getState().setSessionMode('live');
  return store;
}
const legacy = {
  version: 1, identity, config: defaultConfig, leagueSettings: createDefaultLeagueSettings(),
  currentPick: 96, draftHistory: [{ pickNumber: 1, playerId: 'first', playerName: 'First', position: 'WR',
    teamIndex: 0, teamName: 'Team 1', source: 'sync', timestamp: 100 }],
  shortlistedPlayerIds: ['waiting'], preloadedKeepers: [], keepersInitialized: false,
  unresolvedProviderPicks: [], decisionLens: 'best-pick', manualContinuityBaselineAt: null,
  lastConfirmedSyncAt: 100, lastConfirmedPickNumber: 1,
};

describe('persisted progress facts', () => {
  it('keeps the branch-at-96 anchor through save and reload, including a cursor-neutral branch', () => {
    const storage = memoryStorage();
    const first = open(storage);
    first.getState().reconcileSyncedPicks([], 96, [], 100);
    first.getState().branchFromPick(96);
    const reloaded = createDraftStore({ storage, session: identity }).getState();
    expect(reloaded.currentPick).toBe(96);
    expect(reloaded.draftProgress).toEqual({ anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 0 });
    expect(deriveDraftCursor(reloaded.draftHistory, reloaded.draftProgress)).toBe(96);
  });

  it('serializes a mock keeper pause without enabling automatic mock persistence', () => {
    const storage = memoryStorage();
    const mock = createDraftStore({ storage });
    mock.getState().setSessionMode('mock');
    mock.getState().preloadKeepers([{ playerId: 'keeper', playerName: 'Keeper', position: 'RB',
      teamIndex: 1, round: 1, isMyKeeper: false }]);
    mock.getState().markPlayerDrafted('first', 'First', 'WR', 0, 'Team 1');
    expect(storage.values.size).toBe(0);
    expect(mock.getState().currentPick).toBe(2);
    // Exercise the existing live-session serializer with the paused mock's source facts.
    const result = persistDraftSession(storage, { ...mock.getState(), sessionMode: 'live', liveSession: identity }, EMPTY_DRAFT_SESSION_BASE);
    expect(result.status).toBe('written');
    const reloaded = createDraftStore({ storage, session: identity });
    expect(reloaded.getState().currentPick).toBe(2);
    expect(reloaded.getState().draftProgress).toEqual(mock.getState().draftProgress);
    reloaded.getState().setSessionMode('mock');
    reloaded.getState().consumeKeeperAtCurrentPick();
    expect(reloaded.getState().currentPick).toBe(3);
    expect(reloaded.getState().draftHistory.at(-1)?.playerId).toBe('keeper');
  });

  it('keeps sparse provider progress and its captured keeper slots through reload', () => {
    const storage = memoryStorage();
    const first = open(storage);
    first.getState().reconcileSyncedPicks([{ pickNumber: 3, playerId: 'third', playerName: 'Third', position: 'WR',
      teamIndex: 2, teamName: 'Team 3', isMyPick: false }], 96, [], 100);
    const reloaded = createDraftStore({ storage, session: identity }).getState();
    expect(reloaded.currentPick).toBe(96);
    expect(reloaded.draftProgress).toEqual(first.getState().draftProgress);
    expect(reloaded.draftProgress.anchor.kind).toBe('provider');
    expect(reloaded.draftHistory.map(pick => pick.pickNumber)).toEqual([3]);
  });

  it('imports a v1 fixture once as carry and writes v2 on the next save', () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify(legacy));
    const first = createDraftStore({ storage, session: identity });
    expect(first.getState()).toMatchObject({ currentPick: 96, draftHistory: legacy.draftHistory,
      shortlistedPlayerIds: ['waiting'], lastConfirmedSyncAt: 100,
      draftProgress: { anchor: { kind: 'carry', pickNumber: 96 }, historyLength: 1 } });
    first.getState().setDecisionLens('best-player');
    expect(JSON.parse(storage.getItem(key) ?? '{}')).toMatchObject({ version: 2,
      draftProgress: { anchor: { kind: 'carry', pickNumber: 96 }, historyLength: 1 } });
    expect(createDraftStore({ storage, session: identity }).getState().draftProgress).toEqual(first.getState().draftProgress);
  });

  it.each([
    undefined, null, {}, { anchor: { kind: 'unknown' }, historyLength: 1 },
    { anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 2 },
    { anchor: { kind: 'branch', pickNumber: 95 }, historyLength: 1 },
    { anchor: { kind: 'provider', nextPickNumber: 96, totalPicks: 140, keeperSlots: [-1] }, historyLength: 1 },
  ])('rejects only malformed v2 progress and keeps valid picks (%j)', (draftProgress) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ ...legacy, version: 2, draftProgress }));
    const reloaded = createDraftStore({ storage, session: identity }).getState();
    expect(reloaded.draftHistory).toEqual(legacy.draftHistory);
    expect(reloaded.currentPick).toBe(96);
    expect(reloaded.draftProgress).toEqual({ anchor: { kind: 'carry', pickNumber: 96 }, historyLength: 1 });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('progress'), expect.anything());
    expect(parseStoredDraftSession(storage.getItem(key), identity)).not.toBeNull();
  });

  it('recovers an overwritten branch journal after reload', () => {
    const storage = memoryStorage();
    const tabA = open(storage);
    let stale: string | null = null;
    let hideWrites = false;
    const staleStorage = { ...storage, get length() { return storage.length; }, getItem: (storedKey: string) => storedKey === key && hideWrites ? stale : storage.getItem(storedKey) };
    const tabB = open(staleStorage);
    stale = storage.getItem(key);
    hideWrites = true;
    tabA.getState().branchFromPick(96);
    tabB.getState().setDecisionLens('best-player');
    hideWrites = false;
    const reloaded = createDraftStore({ storage, session: identity }).getState();
    expect(reloaded.currentPick).toBe(96);
    expect(reloaded.decisionLens).toBe('best-player');
    expect(reloaded.draftProgress).toEqual({ anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 0 });
  });
});

it('keeps v1 journal picks when their cursor update needs a carry import', () => {
  const storage = memoryStorage();
  storage.setItem(key, JSON.stringify({ ...legacy, revision: 1, lineage: ['base'] }));
  storage.setItem('fantasy-draft-session-unconfirmed-v1:sleeper:123:old-tab', JSON.stringify({
    version: 1, writeId: 'lost', baseWriteId: 'base', revision: 2,
    picks: [{ pickNumber: 2, before: null, after: { ...legacy.draftHistory[0],
      pickNumber: 2, teamIndex: 1, playerId: 'second', playerName: 'Second' } }],
    queueAdded: ['recovered'], queueRemoved: [], fields: { currentPick: { before: 96, after: 97 } },
  }));
  const reloaded = createDraftStore({ storage, session: identity }).getState();
  expect(reloaded.draftHistory.map(pick => pick.playerId)).toEqual(['first', 'second']);
  expect(reloaded.shortlistedPlayerIds).toEqual(['waiting', 'recovered']);
  expect(reloaded.currentPick).toBe(97);
  expect(reloaded.draftProgress).toEqual({ anchor: { kind: 'carry', pickNumber: 97 }, historyLength: 2 });
});

it('rejects a malformed journal progress field without dropping its picks or queue', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const storage = memoryStorage();
  storage.setItem(key, JSON.stringify({ ...legacy, version: 2,
    draftProgress: { anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 1 }, revision: 1, lineage: ['base'] }));
  storage.setItem('fantasy-draft-session-unconfirmed-v1:sleeper:123:old-tab', JSON.stringify({
    version: 1, writeId: 'lost', baseWriteId: 'base', revision: 2,
    picks: [{ pickNumber: 2, before: null, after: { ...legacy.draftHistory[0],
      pickNumber: 2, teamIndex: 1, playerId: 'second', playerName: 'Second' } }],
    queueAdded: ['recovered'], queueRemoved: [], fields: { draftProgress: { before: null, after: { anchor: { kind: 'invalid' } } } },
  }));
  const reloaded = createDraftStore({ storage, session: identity }).getState();
  expect(reloaded.draftHistory.map(pick => pick.playerId)).toEqual(['first', 'second']);
  expect(reloaded.shortlistedPlayerIds).toEqual(['waiting', 'recovered']);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('journal draft progress'), expect.anything());
});

it('preserves the legacy sorted reload cursor when the command prefix interleaves with later picks', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const storage = memoryStorage();
  const first = open(storage);
  first.getState().reconcileSyncedPicks([{ pickNumber: 100, playerId: 'hundred', playerName: 'Hundred', position: 'WR',
    teamIndex: 0, teamName: 'Team 1', isMyPick: false }], 2, [], 100);
  first.getState().markPlayerDrafted('third', 'Third', 'WR', 2, 'Team 3', 3);
  expect(first.getState().currentPick).toBe(4);
  const reloaded = createDraftStore({ storage, session: identity }).getState();
  expect(reloaded.draftHistory.map(pick => pick.pickNumber)).toEqual([3, 100]);
  expect(reloaded.currentPick).toBe(4);
  expect(deriveDraftCursor(reloaded.draftHistory, reloaded.draftProgress)).toBe(4);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('progress'), expect.anything());
});

it('keeps progress on an unrelated stale-tab queue edit and restores a reopen anchor', () => {
  const storage = memoryStorage();
  const first = open(storage);
  const stale = open(storage);
  first.getState().markPlayerDrafted('first', 'First', 'WR', 0, 'Team 1');
  first.getState().undoLastPick();
  stale.getState().togglePlayerShortlisted('waiting');
  const reloaded = createDraftStore({ storage, session: identity }).getState();
  expect(reloaded.currentPick).toBe(1);
  expect(reloaded.shortlistedPlayerIds).toEqual(['waiting']);
  expect(reloaded.draftProgress).toEqual({ anchor: { kind: 'reopen', pickNumber: 1 }, historyLength: 0 });
});

it.each([0, 2.5, 5000])('persists the raw provider cursor fact before command clamping (%s)', (nextPickNumber) => {
  const storage = memoryStorage();
  const first = open(storage);
  first.getState().branchFromPick(96);
  first.getState().reconcileSyncedPicks([], nextPickNumber, [], 100);
  const reloaded = createDraftStore({ storage, session: identity }).getState();
  expect(reloaded.currentPick).toBe(first.getState().currentPick);
  expect(reloaded.draftProgress).toEqual(first.getState().draftProgress);
  expect(reloaded.draftProgress.anchor).toMatchObject({ kind: 'provider', nextPickNumber });
});
