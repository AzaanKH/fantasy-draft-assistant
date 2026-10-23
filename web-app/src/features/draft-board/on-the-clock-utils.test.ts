import { describe, expect, it } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { getDraftView } from '@/workspace/useDraftView';
import { getPicksUntilMyTurn } from './on-the-clock-utils';

describe('getPicksUntilMyTurn', () => {
  it('counts forward to the next user pick in a snake draft', () => {
    expect(getPicksUntilMyTurn(7, 1, 10, 15, 'snake')).toBe(13);
    expect(getPicksUntilMyTurn(20, 1, 10, 15, 'snake')).toBe(0);
  });

  it('returns null when the user has no picks remaining', () => {
    expect(getPicksUntilMyTurn(150, 1, 10, 15, 'snake')).toBeNull();
  });
});

describe('derived turn timing', () => {
  it('tracks the active snake-draft slot as picks advance', () => {
    const store = createDraftStore();
    store.getState().setConfig({ totalTeams: 10, totalRounds: 15, myPickPosition: 1, draftType: 'snake' });
    for (const [pickNumber, expected] of [[1, true], [2, false], [20, true]] as const) {
      store.setState({ draftProgress: { anchor: { kind: 'carry', pickNumber }, historyLength: 0 } });
      expect(getDraftView(store).isMyTurn).toBe(expected);
    }
  });
});
