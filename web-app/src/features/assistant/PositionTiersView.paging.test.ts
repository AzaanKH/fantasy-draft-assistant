import { describe, expect, it } from 'vitest';
import { getTierColumnBudget, TIER_PAGE_SIZE } from './PositionTiersView';

describe('getTierColumnBudget', () => {
  it('grows a column one page at a time instead of rendering every player', () => {
    expect(getTierColumnBudget(0, false)).toBe(20);
    expect(getTierColumnBudget(1, false)).toBe(20 + TIER_PAGE_SIZE);
    expect(getTierColumnBudget(3, false)).toBe(20 + 3 * TIER_PAGE_SIZE);
  });

  it('starts a search one page deeper but still bounded', () => {
    expect(getTierColumnBudget(0, true)).toBe(20 + TIER_PAGE_SIZE);
    expect(Number.isFinite(getTierColumnBudget(0, true))).toBe(true);
  });
});
