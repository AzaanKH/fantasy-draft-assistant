import { describe, expect, it } from 'vitest';
import { getDraftBoardScrollTarget } from './draft-board-scroll';

describe('getDraftBoardScrollTarget', () => {
  it('keeps the first round below the sticky header regardless of page position', () => {
    const target = getDraftBoardScrollTarget({
      containerTop: 320,
      containerLeft: 24,
      containerScrollTop: 0,
      containerScrollLeft: 0,
      containerHeight: 500,
      containerWidth: 1200,
      slotTop: 368,
      slotLeft: 608,
      slotHeight: 72,
      slotWidth: 132,
      stickyHeaderHeight: 48,
      stickyColumnWidth: 56,
    });

    expect(target.top).toBe(0);
  });

  it('centers later picks in the visible area below and beside sticky labels', () => {
    expect(getDraftBoardScrollTarget({
      containerTop: 100,
      containerLeft: 20,
      containerScrollTop: 200,
      containerScrollLeft: 300,
      containerHeight: 500,
      containerWidth: 1000,
      slotTop: 380,
      slotLeft: 620,
      slotHeight: 72,
      slotWidth: 132,
      stickyHeaderHeight: 48,
      stickyColumnWidth: 56,
    })).toEqual({ top: 242, left: 438 });
  });
});
