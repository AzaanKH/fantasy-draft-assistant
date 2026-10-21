import { describe, expect, it } from 'vitest';
import { deriveDraft } from '@fantasy-draft/shared/draft';
import { createDraftStore } from './draftStore';
import { shadowFormat, shadowSource } from './draft/derive-shadow-source';
import { shadowPlayers } from './draft/derive-shadow-catalog';
import { selectIsMyTurn } from './draft/state';

function expectCursor(store: ReturnType<typeof createDraftStore>, cursor: number): void {
  const state = store.getState();
  expect(state.currentPick).toBe(cursor);
  expect(deriveDraft(shadowSource(state), shadowFormat(state)).currentPick).toBe(cursor);
}

describe('DraftSource progress facts', () => {
  it('selects the manager turn after Immer copies state, and clears it after a pick', () => {
    const store = createDraftStore();
    store.getState().setConfig({ myPickPosition: 1 });
    expect(selectIsMyTurn(store.getState())).toBe(true);
    store.getState().setDecisionLens('best-player');
    expect(selectIsMyTurn(store.getState())).toBe(true);
    store.getState().markPlayerDrafted('mine', 'Mine', 'WR', 0, 'My Team');
    expect(selectIsMyTurn(store.getState())).toBe(false);
  });

  it('honors sparse provider progress and provider replacement over branch progress', () => {
    const store = createDraftStore();
    store.getState().branchFromPick(96);
    store.getState().reconcileSyncedPicks([], 39);
    expectCursor(store, 39);
    store.getState().reconcileSyncedPicks([], 12);
    expectCursor(store, 12);
  });

  it('distinguishes otherwise equal empty histories after branching', () => {
    const first = createDraftStore();
    const branched = createDraftStore();
    branched.getState().branchFromPick(96);
    expectCursor(first, 1);
    expectCursor(branched, 96);
    expect(shadowSource(first.getState())).not.toEqual(shadowSource(branched.getState()));
  });

  it('pauses on a reserved keeper, consumes it, and reopens it on undo', () => {
    const store = createDraftStore();
    store.getState().setSessionMode('mock');
    store.getState().preloadKeepers([{ playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 0, round: 1, isMyKeeper: false }]);
    expectCursor(store, 1);
    expect(store.getState().draftedPlayerIds.has('keeper')).toBe(true);
    expect(store.getState().teamRosters[0]?.RB).toEqual(['keeper']);
    store.getState().consumeKeeperAtCurrentPick();
    expectCursor(store, 2);
    store.getState().undoLastPick();
    expectCursor(store, 1);
    store.getState().resetDraft();
    expectCursor(store, 1);
  });
});

it('derives the complete available pool by id and normalized name, plus turn and position permissions', () => {
  const store = createDraftStore();
  store.getState().setConfig({ myPickPosition: 1 });
  store.getState().setSessionMode('mock');
  const player = shadowPlayers[0];
  if (!player) throw new Error('Missing catalog fixture');
  const catalog = [...shadowPlayers, { ...player, id: 'alias', name: 'PLAYER 1' }];
  store.getState().markPlayerDrafted('player-1', 'Player 1', 'QB', 0, 'My Team');
  let view = deriveDraft(shadowSource(store.getState()), shadowFormat(store.getState()), catalog);
  expect(view.available.some(player => player.id === 'alias' || player.id === 'player-1')).toBe(false);
  expect(view.available).toHaveLength(599);
  expect(view.canDraft).toBe(false);
  store.getState().branchFromPick(1);
  view = deriveDraft(shadowSource(store.getState()), shadowFormat(store.getState()), catalog);
  expect(view.canDraft).toBe(true);
  expect(view.canRecord).toBe(false);
  store.getState().setSessionMode('live');
  view = deriveDraft(shadowSource(store.getState()), shadowFormat(store.getState()), catalog);
  expect(view.canDraft).toBe(false);
  expect(view.canRecord).toBe(true);
});

it('preserves accepted provider progress through rule changes and later local appends', () => {
  const store = createDraftStore();
  store.getState().setSessionMode('live');
  store.getState().preloadKeepers([{ playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 0, round: 1, isMyKeeper: false }]);
  store.getState().reconcileSyncedPicks([], 1);
  expectCursor(store, 2);
  store.getState().setConfig({ draftType: 'linear', totalRounds: 15 });
  expectCursor(store, 2);
  store.getState().preloadKeepers([]);
  expectCursor(store, 2);
  store.getState().markPlayerDrafted('next', 'Next', 'WR', 1, 'Team 2');
  expectCursor(store, 3);
  store.getState().markPlayerDrafted('late', 'Late', 'TE', 2, 'Team 3', 40, 'sync');
  expectCursor(store, 41);
  store.getState().undoLastPick();
  expectCursor(store, 40);
});

it('uses the provider cursor even below its history, until a local command advances it', () => {
  const store = createDraftStore();
  store.getState().reconcileSyncedPicks([{
    pickNumber: 20, playerId: 'remote', playerName: 'Remote', position: 'WR',
    teamIndex: 0, teamName: 'Team 1', isMyPick: false,
  }], 4);
  expectCursor(store, 4);
  store.getState().markPlayerDrafted('next', 'Next', 'TE', 3, 'Team 4');
  expectCursor(store, 5);
  store.getState().undoLastPick();
  expectCursor(store, 4);
});

it('pins the browse pool disagreement with ID-only scarcity and the provisional action permission', () => {
  const store = createDraftStore();
  store.getState().setSessionMode('live');
  store.getState().markPlayerDrafted('different-id', 'Player 1', 'QB', 0, 'Team 1');
  const view = deriveDraft(shadowSource(store.getState()), shadowFormat(store.getState()), shadowPlayers);
  const idOnly = shadowPlayers.filter(player => !store.getState().draftedPlayerIds.has(player.id));
  expect(idOnly).toHaveLength(600);
  expect(view.available).toHaveLength(599);
  // The action accepts provisional observations in live mode without the UI's outage prerequisite.
  expect(store.getState().manualContinuityBaselineAt).toBeNull();
  expect(view.canRecord).toBe(true);
  expect(store.getState().recordProvisionalPick({
    pickNumber: 2, playerId: 'observed', playerName: 'Observed', position: 'WR', teamIndex: 1, teamName: 'Team 2',
  })).toBe(true);
});

it('denies drafting at a keeper slot and at each position limit', () => {
  const store = createDraftStore();
  store.getState().setSessionMode('mock');
  store.getState().setConfig({ myPickPosition: 1 });
  store.getState().preloadKeepers([{ playerId: 'keeper', playerName: 'Keeper', position: 'QB', teamIndex: 0, round: 1, isMyKeeper: true }]);
  let view = deriveDraft(shadowSource(store.getState()), shadowFormat(store.getState()), shadowPlayers);
  expect(store.getState().draftProgress.keeperPhase).toBe('pending-consumption');
  expect(view.canDraft).toBe(false);
  store.getState().branchFromPick(20);
  store.getState().setRosterRequirements({
    ...store.getState().config.rosterRequirements,
    QB: { ...store.getState().config.rosterRequirements.QB, max: 1 },
  });
  view = deriveDraft(shadowSource(store.getState()), shadowFormat(store.getState()), shadowPlayers);
  expect(view.canDraft).toBe(true);
  expect(view.canDraftByPosition.QB).toBe(false);
  expect(view.canDraftByPosition.WR).toBe(true);
});
