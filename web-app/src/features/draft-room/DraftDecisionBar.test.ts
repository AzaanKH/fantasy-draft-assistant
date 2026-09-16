import { describe, expect, it } from 'vitest';
import type {
  Recommendation,
  RecommendationDecisionFactors,
} from '@fantasy-draft/shared';
import { getDraftDecisionBarReason } from './draft-decision-bar-reason';

function decisionFactors(): RecommendationDecisionFactors {
  return {
    playerQuality: { ecrRank: 8, score: -8 },
    leagueValue: {
      score: 2,
      minScore: 0,
      maxScore: 6,
      projectedPoints: 240,
      replacementPoints: 200,
      valueOverReplacement: 40,
      materiallyChangedOrdering: false,
    },
    rosterFit: {
      score: 6,
      minScore: 0,
      maxScore: 8,
      fixedStartersOpen: 2,
      flexSlotsOpen: 1,
      benchSlotsOpen: 5,
      selectionsRemaining: 8,
      legalCompletionPossible: true,
      materiallyChangedOrdering: false,
    },
    tierSupply: {
      score: 3,
      minScore: 0,
      maxScore: 4,
      currentTier: 2,
      remainingInTier: 1,
      nextTier: 3,
      nextTierProjectedPoints: 220,
      dropoffPoints: 20,
      meaningfulCliff: true,
      costOfWaiting: 3,
      materiallyChangedOrdering: false,
    },
    draftTiming: {
      score: 4,
      minScore: 0,
      maxScore: 4,
      nextPickNumber: 25,
      nextPickLabel: '3.05',
      picksUntilNextPick: 10,
      returnProbability: 0.18,
      candidateValue: 40,
      costOfWaiting: 16.5,
      materiallyChangedOrdering: false,
    },
    conservativeBoundary: {
      ecrRankLimit: 9,
      samePositionTier: false,
      withinBoundary: true,
      feasibilityException: false,
    },
  };
}

function recommendation(
  factors: RecommendationDecisionFactors | null = decisionFactors()
): Recommendation {
  return {
    playerId: 'best-pick',
    playerName: 'Best Pick',
    position: 'RB',
    reason: 'critical roster need · RB Tier 2',
    score: 12,
    ...(factors ? { decisionFactors: factors } : {}),
  };
}

describe('getDraftDecisionBarReason', () => {
  it('uses the dominant divergence factor for the short reason', () => {
    expect(getDraftDecisionBarReason(recommendation(), 'draft-timing')).toBe(
      'Waiting costs 16.5 expected points before your next selection.'
    );
    expect(getDraftDecisionBarReason(recommendation(), 'tier-supply')).toBe(
      '1 RB option remains in Tier 2 before a 20.0 point drop.'
    );
  });

  it('puts a legal-roster requirement ahead of other factors', () => {
    const factors = decisionFactors();
    const feasibilityFactors: RecommendationDecisionFactors = {
      ...factors,
      conservativeBoundary: {
        ...factors.conservativeBoundary,
        feasibilityException: true,
      },
      rosterFit: {
        ...factors.rosterFit,
        selectionsRemaining: 1,
      },
    };

    expect(getDraftDecisionBarReason(
      recommendation(feasibilityFactors),
      'draft-timing'
    )).toBe('Keeps a legal roster possible with 1 selection left.');
  });

  it('reduces legacy recommendation text to its first plain-language reason', () => {
    expect(getDraftDecisionBarReason(recommendation(null))).toBe(
      'Critical roster need.'
    );
  });
});
