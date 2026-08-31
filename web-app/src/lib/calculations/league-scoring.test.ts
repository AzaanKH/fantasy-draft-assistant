import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_RULES,
  type FantasyProsProjection,
  type ScoringRules,
} from '@fantasy-draft/shared';
import { calculateLeagueProjection } from './league-scoring';

const projection: FantasyProsProjection = {
  name: 'Example Player',
  position: 'TE',
  team: 'DET',
  projectedPoints: 200,
  baseProjectedPoints: 200,
  projectedRushAttempts: 10,
  projectedReceptions: 80,
  projectedReceivingYards: 900,
  projectedReceivingTouchdowns: 7,
};

function withReceivingPoints(reception: number): ScoringRules {
  return {
    ...DEFAULT_SCORING_RULES,
    receiving: {
      ...DEFAULT_SCORING_RULES.receiving,
      reception,
      tePremium: 0,
    },
    rushing: {
      ...DEFAULT_SCORING_RULES.rushing,
      attemptBonus: 0,
    },
  };
}

describe('calculateLeagueProjection', () => {
  it('adds TE premium and rushing-attempt bonuses to the raw PPR baseline', () => {
    expect(
      calculateLeagueProjection(projection, 'TE', DEFAULT_SCORING_RULES)
    ).toEqual({
      projectedPoints: 242,
      adjustment: 42,
    });
  });

  it('removes half a point per reception for a half-PPR league', () => {
    expect(
      calculateLeagueProjection(projection, 'TE', withReceivingPoints(0.5))
    ).toEqual({
      projectedPoints: 160,
      adjustment: -40,
    });
  });

  it('does not apply a TE premium to other positions', () => {
    expect(
      calculateLeagueProjection(projection, 'WR', DEFAULT_SCORING_RULES)
    ).toEqual({
      projectedPoints: 202,
      adjustment: 2,
    });
  });
});
