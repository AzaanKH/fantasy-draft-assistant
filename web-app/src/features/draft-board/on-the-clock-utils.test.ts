import { describe, expect, it } from 'vitest';
import { calculateIsMyTurn } from '@/stores/draftStore';
import { getPicksUntilMyTurn } from './on-the-clock-utils';

describe('getPicksUntilMyTurn', () => {
  it('counts forward to the next user pick in a snake draft', () => {
    expect(getPicksUntilMyTurn(7, 1, 10, 15)).toBe(13);
    expect(getPicksUntilMyTurn(20, 1, 10, 15)).toBe(0);
  });

  it('returns null when the user has no picks remaining', () => {
    expect(getPicksUntilMyTurn(150, 1, 10, 15)).toBeNull();
  });
});

describe('calculateIsMyTurn', () => {
  it('tracks the active snake-draft slot as picks advance', () => {
    expect(calculateIsMyTurn(1, 1, 10)).toBe(true);
    expect(calculateIsMyTurn(2, 1, 10)).toBe(false);
    expect(calculateIsMyTurn(20, 1, 10)).toBe(true);
  });
});
