import { describe, expect, it } from 'vitest';
import type {
  DecisionDivergenceFactor,
  Recommendation,
  RecommendationDecisionFactors,
} from '@fantasy-draft/shared';
import { createDraftDecisionOutput } from './draft-decision';

function recommendation(
  playerId: string,
  playerName: string,
  expertRank: number
): Recommendation {
  return {
    playerId,
    playerName,
    position: 'WR',
    reason: `ECR #${String(expertRank)}`,
    score: -expertRank,
    diagnostics: {
      expertRank,
      marketRank: expertRank,
      marketDelta: 0,
      projectedPoints: 200,
      valueOverReplacement: 20,
      tier: 1,
    },
  };
}

function policyFactors(
  factor: DecisionDivergenceFactor,
  preferred: boolean
): RecommendationDecisionFactors {
  return {
    playerQuality: { ecrRank: preferred ? 3 : 1, score: preferred ? -3 : -1 },
    leagueValue: {
      score: preferred ? 2 : 0,
      minScore: 0,
      maxScore: 6,
      projectedPoints: preferred ? 245 : 202,
      replacementPoints: 200,
      valueOverReplacement: preferred ? 45 : 2,
      materiallyChangedOrdering: preferred && factor === 'league-value',
    },
    rosterFit: {
      score: preferred ? 8 : 1,
      minScore: 0,
      maxScore: 8,
      fixedStartersOpen: 2,
      flexSlotsOpen: 0,
      benchSlotsOpen: 3,
      selectionsRemaining: 3,
      legalCompletionPossible: true,
      materiallyChangedOrdering: preferred && factor === 'roster-fit',
    },
    tierSupply: {
      score: preferred ? 4 : 0,
      minScore: 0,
      maxScore: 4,
      currentTier: 2,
      remainingInTier: 1,
      nextTier: 3,
      nextTierProjectedPoints: 230,
      dropoffPoints: 15,
      meaningfulCliff: true,
      costOfWaiting: 4,
      materiallyChangedOrdering: preferred && factor === 'tier-supply',
    },
    draftTiming: {
      score: preferred ? 3 : 0,
      minScore: 0,
      maxScore: 4,
      nextPickNumber: 13,
      nextPickLabel: '2.03',
      picksUntilNextPick: 5,
      returnProbability: preferred ? 0.05 : 0.8,
      candidateValue: preferred ? 45 : 2,
      costOfWaiting: preferred ? 18 : 0,
      materiallyChangedOrdering: preferred && factor === 'draft-timing',
    },
    conservativeBoundary: {
      ecrRankLimit: 9,
      samePositionTier: false,
      withinBoundary: true,
      feasibilityException: false,
    },
  };
}

function policyRecommendation(
  playerId: string,
  playerName: string,
  expertRank: number,
  factor: DecisionDivergenceFactor,
  preferred: boolean
): Recommendation {
  return {
    ...recommendation(playerId, playerName, expertRank),
    position: preferred ? 'RB' : 'WR',
    decisionFactors: policyFactors(factor, preferred),
  };
}

describe('createDraftDecisionOutput', () => {
  it('always exposes both answers, the selected lens, and divergence', () => {
    const bestPick = recommendation('roster-fit', 'Roster Fit', 8);
    const bestPlayer = recommendation('ecr-leader', 'ECR Leader', 4);

    const output = createDraftDecisionOutput(
      [bestPick, bestPlayer],
      { preferredPlayerId: bestPick.playerId, policy: 'league-aware-score' },
      [bestPlayer, bestPick],
      'best-player'
    );

    expect(output).toMatchObject({
      bestPick,
      bestPlayer,
      selectedLens: 'best-player',
      selected: bestPlayer,
      decisionDivergence: true,
    });
    expect(output.bestPickView.preferred).toBe(bestPick);
    expect(output.bestPlayerView.preferred).toBe(bestPlayer);
    expect(output.selectedView).toBe(output.bestPlayerView);
    expect(output.decisionDivergenceFactor).toBeNull();
    expect(output.decisionDivergenceExplanation).toBeNull();
  });

  it.each([
    {
      factor: 'league-value' as const,
      expected: '45 points above replacement, 43 more than ECR Leader in this league',
    },
    {
      factor: 'roster-fit' as const,
      expected: "Roster Builder's RB roster fit matters with 2 starting spots open and 3 selections left",
    },
    {
      factor: 'tier-supply' as const,
      expected: 'only 1 RB remains in Tier 2 before a 15 point drop',
    },
    {
      factor: 'draft-timing' as const,
      expected: '5% Return Probability at pick 2.03, and waiting costs 18 expected points',
    },
  ])('explains a $factor divergence from the factor that changed the order', ({
    factor,
    expected,
  }) => {
    const bestPick = policyRecommendation(
      'roster-fit',
      'Roster Builder',
      3,
      factor,
      true
    );
    const bestPlayerPolicyVersion = policyRecommendation(
      'ecr-leader',
      'ECR Leader',
      1,
      factor,
      false
    );
    const bestPlayer = recommendation('ecr-leader', 'ECR Leader', 1);

    const output = createDraftDecisionOutput(
      [bestPick, bestPlayerPolicyVersion],
      { preferredPlayerId: bestPick.playerId, policy: 'primary-league-policy' },
      [bestPlayer],
      'best-player'
    );

    expect(output.decisionDivergenceFactor).toBe(factor);
    expect(output.decisionDivergenceExplanation).toContain(expected);
    expect(output.decisionDivergenceExplanation).toContain(
      'while ECR Leader remains Best Player at ECR #1.'
    );
  });

  it('defaults cleanly to Best Pick when both lenses agree', () => {
    const player = recommendation('consensus', 'Consensus Player', 1);
    const output = createDraftDecisionOutput(
      [player],
      { preferredPlayerId: player.playerId, policy: 'ecr-anchor' },
      [player],
      'best-pick'
    );

    expect(output.selected).toBe(player);
    expect(output.selectedView).toBe(output.bestPickView);
    expect(output.decisionDivergence).toBe(false);
    expect(output.decisionDivergenceFactor).toBeNull();
    expect(output.decisionDivergenceExplanation).toBeNull();
  });
});
