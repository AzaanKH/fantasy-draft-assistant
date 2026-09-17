import { describe, expect, it } from 'vitest';
import type { Recommendation } from '@fantasy-draft/shared';
import {
  createDraftDecisionView,
  getPreferredRecommendation,
} from '@/features/recommendations/draft-decision';
import { getPositionRecommendations } from './assistant-position-rankings';

function createRecommendation(
  playerId: string,
  expertRank: number,
  score: number
): Recommendation {
  return {
    playerId,
    playerName: playerId,
    position: 'WR',
    reason: expertRank === 2 ? 'PickEV override +5.0' : 'ECR champion',
    score,
    diagnostics: {
      expertRank,
      marketRank: expertRank,
      marketDelta: 0,
      projectedPoints: 250,
      valueOverReplacement: 75,
      tier: 1,
    },
  };
}

describe('getPositionRecommendations', () => {
  it('preserves the canonical league-aware order and selection policy', () => {
    const leaguePreferred = createRecommendation('league-preferred', 2, 105);
    const ecrLeader = createRecommendation('ecr-leader', 1, 100);
    const decision = createDraftDecisionView(
      [leaguePreferred, ecrLeader],
      {
        preferredPlayerId: leaguePreferred.playerId,
        policy: 'pick-ev-override',
        overrideAdvantage: 5,
        overrideThreshold: 4,
      }
    );

    const recommendations = getPositionRecommendations(decision);

    expect(recommendations).toBe(decision.recommendations);
    expect(recommendations.map((recommendation) => recommendation.playerId)).toEqual([
      'league-preferred',
      'ecr-leader',
    ]);
    expect(decision.preferredPlayerId).toBe('league-preferred');
    expect(decision.rankByPlayerId.get('league-preferred')).toBe(1);
    expect(decision.selection.policy).toBe('pick-ev-override');
    expect(decision.explanationByPlayerId.get('league-preferred')).toContain('league-preferred');
  });

  it('keeps Compare aligned with an ECR-anchor decision when raw score disagrees', () => {
    const ecrChampion = createRecommendation('ecr-champion', 1, 100);
    const higherRawScore = createRecommendation('higher-raw-score', 2, 110);
    const decision = createDraftDecisionView(
      [ecrChampion, higherRawScore],
      {
        preferredPlayerId: ecrChampion.playerId,
        policy: 'ecr-anchor',
        overrideAdvantage: 10,
        overrideThreshold: 4,
      }
    );

    expect(getPreferredRecommendation(decision, [higherRawScore, ecrChampion])).toBe(ecrChampion);
  });
});
