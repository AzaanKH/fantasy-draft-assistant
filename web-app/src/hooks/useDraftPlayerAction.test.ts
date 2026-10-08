import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS } from '@fantasy-draft/shared';
import { canDraftFromWorkspace, isPositionFull } from './useDraftPlayerAction';

describe('canDraftFromWorkspace', () => {
  it('keeps live and setup workspaces read-only', () => {
    expect(canDraftFromWorkspace('live', true, false)).toBe(false);
    expect(canDraftFromWorkspace('setup', true, false)).toBe(false);
  });

  it('allows local pick mutation only during a manager mock turn', () => {
    expect(canDraftFromWorkspace('mock', true, false)).toBe(true);
    expect(canDraftFromWorkspace('mock', false, false)).toBe(false);
    expect(canDraftFromWorkspace('mock', true, true)).toBe(false);
  });
});

describe('isPositionFull', () => {
  const empty = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };

  it('blocks a position once the roster holds its maximum', () => {
    const kickers = Array.from({ length: DEFAULT_ROSTER_REQUIREMENTS.K.max }, (_, index) => `k-${String(index)}`);
    expect(isPositionFull('K', { ...empty, K: kickers }, DEFAULT_ROSTER_REQUIREMENTS)).toBe(true);
    expect(isPositionFull('K', empty, DEFAULT_ROSTER_REQUIREMENTS)).toBe(DEFAULT_ROSTER_REQUIREMENTS.K.max === 0);
  });

  it('blocks a position the league does not roster', () => {
    const noDefense = { ...DEFAULT_ROSTER_REQUIREMENTS, DEF: { starters: 0, max: 0 } };
    expect(isPositionFull('DEF', empty, noDefense)).toBe(true);
  });
});
