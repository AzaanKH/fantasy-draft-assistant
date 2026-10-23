import { describe, expect, expectTypeOf, it } from 'vitest';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import { POSITIONS, type Position } from '@fantasy-draft/shared/league';
import { createDraftStore } from './draftStore';
import { deriveDraftState } from './draft/source';
import { draftPlayers } from './draft/draft-catalog';
import type { DraftState } from './draft/types';

const projectionKeys = ['currentPick', 'draftedPlayerIds', 'myRoster', 'teamRosters', 'totalPicks'] as const;

type StoredProjections = Extract<keyof DraftState, typeof projectionKeys[number]>;

it('keeps projections out of store state, derive it with deriveDraft/useDraftView', () => {
  expectTypeOf<StoredProjections>().toEqualTypeOf<never>();
  const store = createDraftStore();
  store.getState().setSessionMode('mock');
  store.getState().markPlayerDrafted('player-1', 'Player 1', 'QB', 0, 'Team 1');
  for (const state of [store.getInitialState(), store.getState()]) {
    expect(projectionKeys.filter(key => key in state), 'derive it with deriveDraft/useDraftView').toEqual([]);
  }
});

describe('source command replay against deriveDraft', () => {
  it('derives each of 140 CPU and keeper transitions, then undo, branch and reset', () => {
    const store = createDraftStore();
    const order = createSlotSequence({ type: 'snake', teams: 10, rounds: 14 });
    const keeperPicks = [1, 70, 140];
    store.getState().setSessionMode('mock');
    store.getState().preloadKeepers(keeperPicks.map(pick => ({
      playerId: `keeper-${pick}`, playerName: `Keeper ${pick}`, position: 'RB',
      teamIndex: order.at(pick).teamIndex, round: order.at(pick).round,
      isMyKeeper: order.at(pick).teamIndex === 4,
    })));
    for (const id of ['waiting-a', 'player-50', 'waiting-b']) store.getState().togglePlayerShortlisted(id);
    const rosters: Record<Position, string[]>[] = Array.from({ length: 10 }, () => ({ QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] }));
    const ids = new Set(keeperPicks.map(pick => `keeper-${pick}`));
    for (const pick of keeperPicks) rosters[order.at(pick).teamIndex]?.RB.push(`keeper-${pick}`);
    for (const slot of order.slots) {
      const before = deriveDraftState(store.getState(), draftPlayers);
      expect(before.currentPick).toBe(slot.pick);
      if (keeperPicks.includes(slot.pick)) {
        expect(before.canDraft).toBe(false);
        store.getState().consumeKeeperAtCurrentPick();
      } else {
        const position = POSITIONS[(slot.pick - 1) % POSITIONS.length] ?? 'WR';
        const id = `player-${slot.pick}`;
        store.getState().markPlayerDrafted(id, `Player ${slot.pick}`, position, slot.teamIndex, `Team ${slot.teamIndex + 1}`, undefined, 'cpu');
        ids.add(id);
        rosters[slot.teamIndex]?.[position].push(id);
      }
      const view = deriveDraftState(store.getState(), draftPlayers);
      expect(view.currentPick).toBe(slot.pick + 1);
      expect(view.draftedPlayerIds).toEqual(ids);
      expect(view.teamRosters).toEqual(rosters);
      expect(view.myRoster).toEqual(rosters[4]);
      expect(view.available).toEqual(draftPlayers.filter(player => !ids.has(player.id)));
    }
    expect(deriveDraftState(store.getState()).shortlistedPlayerIds).toEqual(['waiting-a', 'waiting-b']);
    expect(deriveDraftState(store.getState()).isMyTurn).toBe(false);
    store.getState().undoLastPick();
    expect(deriveDraftState(store.getState()).currentPick).toBe(140);
    expect(deriveDraftState(store.getState()).draftedPlayerIds.size).toBe(140);
    store.getState().branchFromPick(96);
    expect(deriveDraftState(store.getState()).currentPick).toBe(96);
    expect(store.getState().draftHistory.every(pick => pick.pickNumber < 96)).toBe(true);
    store.getState().resetDraft();
    const reset = deriveDraftState(store.getState());
    expect(reset.currentPick).toBe(1);
    expect(reset.draftedPlayerIds).toEqual(new Set(keeperPicks.map(pick => `keeper-${pick}`)));
  });

  it('preserves the queue command that removes keeper assignments without reintroducing them', () => {
    const store = createDraftStore();
    for (const id of ['first', 'keeper', 'last']) store.getState().togglePlayerShortlisted(id);
    store.getState().preloadKeepers([{ playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 0, round: 1, isMyKeeper: false }]);
    expect(store.getState().shortlistedPlayerIds).toEqual(['first', 'last']);
    expect(deriveDraftState(store.getState()).shortlistedPlayerIds).toEqual(['first', 'last']);
    store.getState().preloadKeepers([]);
    expect(deriveDraftState(store.getState()).shortlistedPlayerIds).toEqual(['first', 'last']);
  });
});

it('removes synced queue intent before a provider later removes that pick', () => {
  const store = createDraftStore();
  store.getState().setSessionMode('live');
  for (const id of ['first', 'synced', 'last']) store.getState().togglePlayerShortlisted(id);
  store.getState().reconcileSyncedPicks([{
    pickNumber: 1, playerId: 'synced', playerName: 'Synced', position: 'WR', teamIndex: 0, teamName: 'Team 1', isMyPick: false,
  }], 2);
  expect(store.getState().shortlistedPlayerIds).toEqual(['first', 'last']);
  store.getState().reconcileSyncedPicks([], 1);
  expect(deriveDraftState(store.getState()).shortlistedPlayerIds).toEqual(['first', 'last']);
});

it.each(['branch', 'provisional', 'hydrate'] as const)('prunes already-drafted queue intent on %s', (command) => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  const session = { provider: 'sleeper', draftId: '123' } as const;
  const store = createDraftStore({ storage, session });
  store.getState().setSessionMode('live');
  store.getState().markPlayerDrafted('taken', 'Taken', 'WR', 0, 'Team 1', 1, 'manual');
  store.setState({ shortlistedPlayerIds: ['first', 'taken', 'last'] });
  if (command === 'branch') {
    store.getState().branchFromPick(2);
  } else if (command === 'provisional') {
    expect(store.getState().recordProvisionalPick({
      playerId: 'observed', playerName: 'Observed', position: 'RB', teamIndex: 1, teamName: 'Team 2', pickNumber: 2,
    })).toBe(true);
  } else {
    const reloaded = createDraftStore({ storage, session });
    expect(reloaded.getState().shortlistedPlayerIds).toEqual(['first', 'last']);
    return;
  }
  expect(store.getState().shortlistedPlayerIds).toEqual(['first', 'last']);
});
