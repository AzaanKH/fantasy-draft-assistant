import { describe, it, expect } from 'vitest';
import { determineHighlightLevel } from './highlight.js';
import type { TeamEnvironment } from '../../team-environment.js';

function createTeamEnv(offenseScore: number): TeamEnvironment {
  return {
    team: 'DET',
    name: 'Detroit Lions',
    offenseScore,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 1,
    passAttemptsRank: 5,
    rushAttemptsRank: 12,
    coachingStability: true,
  };
}

describe('determineHighlightLevel', () => {
  it.each([
    ['avoid at the -15 threshold, whatever else applies', -15, true, 10, 'avoid'],
    ['neutral just above the avoid threshold', -14, false, 8, 'neutral'],
    ['strong-buy at value 10 in a contract year', 10, true, undefined, 'strong-buy'],
    ['strong-buy at value 10 on a top offense', 10, false, 8, 'strong-buy'],
    ['good-value at value 10 without a contract year or top offense', 10, false, 7, 'good-value'],
    ['good-value just below strong-buy in a contract year', 9, true, undefined, 'good-value'],
    ['good-value at value 5', 5, false, undefined, 'good-value'],
    ['neutral just below good-value', 4, false, 7, 'neutral'],
    ['good-value for a contract year on a decent offense', 0, true, 6, 'good-value'],
    ['neutral for a contract year on a weak offense', 0, true, 5, 'neutral'],
    ['neutral with no special factors', 0, false, undefined, 'neutral'],
  ] as const)('returns %s', (_label, value, contractYear, offense, level) => {
    expect(determineHighlightLevel(value, contractYear, offense === undefined ? undefined : createTeamEnv(offense))).toBe(level);
  });
});
