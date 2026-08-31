import { describe, expect, it } from 'vitest';
import type { Recommendation } from '@fantasy-draft/shared';
import { sortRecommendationsForPool } from './AssistantPage';

function recommendation(
  playerId: string,
  tier: number,
  score: number
): Recommendation {
  return {
    playerId,
    playerName: playerId,
    position: 'WR',
    reason: 'Test recommendation',
    score,
    diagnostics: {
      expertRank: 1,
      marketRank: 1,
      projectedPoints: 250,
      valueOverReplacement: 100,
      marketDelta: 0,
      nextPickSurvivalProbability: 0.5,
      tier,
      tierRemaining: 2,
      isLastInTier: false,
    },
  };
}

describe('sortRecommendationsForPool', () => {
  const ranked = [
    recommendation('model-first', 3, 100),
    recommendation('tier-one-lower-score', 1, 80),
    recommendation('tier-one-higher-score', 1, 90),
  ];

  it('preserves model recommendation order by default', () => {
    expect(sortRecommendationsForPool(ranked, 'recommendation')).toEqual(ranked);
  });

  it('groups lower tier numbers first and preserves model order within each tier', () => {
    expect(sortRecommendationsForPool(ranked, 'tier').map((item) => item.playerId)).toEqual([
      'tier-one-lower-score',
      'tier-one-higher-score',
      'model-first',
    ]);
  });
});
