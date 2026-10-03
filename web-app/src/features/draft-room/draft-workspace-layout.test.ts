import { describe, expect, it } from 'vitest';
import { clampBoardHeight, MIN_BOARD_HEIGHT } from './draft-workspace-layout';

describe('clampBoardHeight', () => {
  it('keeps the board between its minimum and the space left by the player workspace', () => {
    expect(clampBoardHeight(40, 500)).toBe(MIN_BOARD_HEIGHT);
    expect(clampBoardHeight(900, 500)).toBe(500);
    expect(clampBoardHeight(333.6, 500)).toBe(334);
  });

  it('never returns less than the minimum when the window leaves no room', () => {
    expect(clampBoardHeight(300, 90)).toBe(MIN_BOARD_HEIGHT);
  });
});
