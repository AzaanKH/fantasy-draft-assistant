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
});
