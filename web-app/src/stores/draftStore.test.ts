import { beforeEach, describe, expect, it } from 'vitest';
import { useDraftStore } from './draftStore';

describe('draftStore shortlist', () => {
  beforeEach(() => {
    useDraftStore.getState().resetDraft();
  });

  it('keeps players in the order they were starred and toggles them off', () => {
    const { togglePlayerShortlisted } = useDraftStore.getState();

    togglePlayerShortlisted('player-a');
    togglePlayerShortlisted('player-b');
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([
      'player-a',
      'player-b',
    ]);

    togglePlayerShortlisted('player-a');
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual(['player-b']);
  });

  it('removes drafted players and does not add them back to the shortlist', () => {
    const { markPlayerDrafted, togglePlayerShortlisted } = useDraftStore.getState();

    togglePlayerShortlisted('player-a');
    markPlayerDrafted('player-a', 'Player A', 'WR', 0, 'Team 1');
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([]);

    togglePlayerShortlisted('player-a');
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([]);
  });

  it('removes shortlisted players when importing a pick', () => {
    const { markPlayerDrafted, togglePlayerShortlisted } = useDraftStore.getState();

    togglePlayerShortlisted('player-a');
    markPlayerDrafted('player-a', 'Player A', 'WR', 1, 'Team 1', 3);
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([]);
  });

  it('restores a shortlisted player in the same position when undoing a pick', () => {
    const { markPlayerDrafted, togglePlayerShortlisted, undoLastPick } =
      useDraftStore.getState();

    togglePlayerShortlisted('player-a');
    togglePlayerShortlisted('player-b');
    markPlayerDrafted('player-a', 'Player A', 'WR', 0, 'Team 1');
    undoLastPick();

    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([
      'player-a',
      'player-b',
    ]);
  });

  it('replaces imported Sleeper picks when the canonical snapshot changes', () => {
    const { reconcileSleeperPicks } = useDraftStore.getState();

    reconcileSleeperPicks([
      {
        pickNumber: 1,
        playerId: 'player-a',
        playerName: 'Player A',
        position: 'WR',
        teamIndex: 0,
        teamName: 'My Team',
        isMyPick: true,
      },
      {
        pickNumber: 2,
        playerId: 'player-b',
        playerName: 'Player B',
        position: 'RB',
        teamIndex: 1,
        teamName: 'Team 2',
        isMyPick: false,
      },
    ]);

    reconcileSleeperPicks([
      {
        pickNumber: 1,
        playerId: 'player-c',
        playerName: 'Player C',
        position: 'TE',
        teamIndex: 0,
        teamName: 'My Team',
        isMyPick: true,
      },
    ]);

    const state = useDraftStore.getState();
    expect([...state.draftedPlayerIds]).toEqual(['player-c']);
    expect(state.myRoster.TE).toEqual(['player-c']);
    expect(state.myRoster.WR).toEqual([]);
    expect(state.currentPick).toBe(2);
  });
});
