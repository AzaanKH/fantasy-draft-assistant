import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS } from './draft.js';
import { optimizeLineupUtility, type LineupPlayer } from './lineup-utility.js';

function player(
  id: string,
  position: LineupPlayer['position'],
  projectedPoints: number
): LineupPlayer {
  return { id, position, projectedPoints, ceilingScore: 6 };
}

describe('lineup utility', () => {
  it('optimizes fixed and FLEX starters from the configured requirements', () => {
    const utility = optimizeLineupUtility([
      player('rb-1', 'RB', 250),
      player('rb-2', 'RB', 225),
      player('rb-3', 'RB', 210),
      player('wr-1', 'WR', 240),
      player('wr-2', 'WR', 220),
      player('wr-3', 'WR', 205),
      player('te-1', 'TE', 190),
    ], DEFAULT_ROSTER_REQUIREMENTS);

    expect(utility).toBe(1540);
  });
});
