import { describe, expect, it } from 'vitest';
import type { Recommendation } from '@fantasy-draft/shared';
import { getRecommendationExplanation } from './recommendation-explanation';

describe('getRecommendationExplanation', () => {
  it('names the policy factors and the legal-roster exception from the decision output', () => {
    const recommendation: Recommendation = {
      playerId: 'player-k',
      playerName: 'Required Kicker',
      position: 'K',
      reason: 'Legal-roster requirement',
      score: -20,
      diagnostics: {
        expertRank: 30,
        marketRank: 30,
        projectedPoints: 130,
        valueOverReplacement: 12,
        marketDelta: 0,
        tier: 2,
      },
      decisionFactors: {
        playerQuality: { ecrRank: 30, score: -30 },
        leagueValue: {
          score: 0.5,
          minScore: 0,
          maxScore: 6,
          projectedPoints: 130,
          replacementPoints: 118,
          valueOverReplacement: 12,
        },
        rosterFit: {
          score: 8,
          minScore: 0,
          maxScore: 8,
          fixedStartersOpen: 1,
          flexSlotsOpen: 0,
          benchSlotsOpen: 0,
          selectionsRemaining: 1,
          legalCompletionPossible: true,
        },
        tierSupply: {
          score: 0,
          minScore: 0,
          maxScore: 4,
          currentTier: 2,
          remainingInTier: 1,
          dropoffPoints: 0,
          meaningfulCliff: false,
          costOfWaiting: 0,
          materiallyChangedOrdering: false,
        },
        draftTiming: {
          score: 0,
          minScore: 0,
          maxScore: 4,
          candidateValue: 12,
          costOfWaiting: 0,
          materiallyChangedOrdering: false,
        },
        conservativeBoundary: {
          ecrRankLimit: 9,
          samePositionTier: false,
          withinBoundary: false,
          feasibilityException: true,
        },
      },
    };

    const explanation = getRecommendationExplanation(recommendation);

    expect(explanation).toContain('anchored at ECR #30');
    expect(explanation).toContain('Primary League value adds 0.5 policy points');
    expect(explanation).toContain('Roster fit adds 8.0 policy points');
    expect(explanation).toContain('roster-feasibility exception');
  });

  it('explains the tier supply factor when it changes Best Pick', () => {
    const recommendation: Recommendation = {
      playerId: 'last-rb',
      playerName: 'Last Tier RB',
      position: 'RB',
      reason: 'Tier wait cost',
      score: 7,
      diagnostics: {
        expertRank: 3,
        marketRank: 3,
        projectedPoints: 220,
        valueOverReplacement: 0,
        marketDelta: 0,
        tier: 1,
        tierRemaining: 1,
        tierDropoffPoints: 40,
        costOfWaiting: 4,
      },
      decisionFactors: {
        playerQuality: { ecrRank: 3, score: -3 },
        leagueValue: {
          score: 0,
          minScore: 0,
          maxScore: 6,
          projectedPoints: 220,
          replacementPoints: 220,
          valueOverReplacement: 0,
        },
        rosterFit: {
          score: 6,
          minScore: 0,
          maxScore: 8,
          fixedStartersOpen: 7,
          flexSlotsOpen: 2,
          benchSlotsOpen: 5,
          selectionsRemaining: 14,
          legalCompletionPossible: true,
        },
        tierSupply: {
          score: 4,
          minScore: 0,
          maxScore: 4,
          currentTier: 1,
          remainingInTier: 1,
          nextTier: 2,
          nextTierProjectedPoints: 180,
          dropoffPoints: 40,
          meaningfulCliff: true,
          costOfWaiting: 4,
          materiallyChangedOrdering: true,
        },
        draftTiming: {
          score: 0,
          minScore: 0,
          maxScore: 4,
          candidateValue: 0,
          costOfWaiting: 0,
          materiallyChangedOrdering: false,
        },
        conservativeBoundary: {
          ecrRankLimit: 9,
          samePositionTier: false,
          withinBoundary: true,
          feasibilityException: false,
        },
      },
    };

    const explanation = getRecommendationExplanation(recommendation);

    expect(explanation).toContain(
      'Tier supply adds 4.0 cost-of-waiting points with 1 left in RB Tier 1'
    );
    expect(explanation).toContain('a 40.0 point drop to the next tier');
    expect(explanation).toContain('That tier cliff changed Best Pick.');
  });

  it('names the next-pick window, expected fallback, and timing override', () => {
    const recommendation: Recommendation = {
      playerId: 'urgent-rb',
      playerName: 'Urgent RB',
      position: 'RB',
      reason: 'Next-pick timing',
      score: 6.1,
      diagnostics: {
        expertRank: 3,
        marketRank: 4,
        projectedPoints: 240,
        valueOverReplacement: 24,
        marketDelta: 1,
        tier: 1,
        nextPickSurvivalProbability: 0.05,
        nextPickNumber: 13,
        nextPickLabel: '2.03',
      },
      decisionFactors: {
        playerQuality: { ecrRank: 3, score: -3 },
        leagueValue: {
          score: 1,
          minScore: 0,
          maxScore: 6,
          projectedPoints: 240,
          replacementPoints: 216,
          valueOverReplacement: 24,
        },
        rosterFit: {
          score: 6,
          minScore: 0,
          maxScore: 8,
          fixedStartersOpen: 7,
          flexSlotsOpen: 2,
          benchSlotsOpen: 5,
          selectionsRemaining: 14,
          legalCompletionPossible: true,
        },
        tierSupply: {
          score: 0,
          minScore: 0,
          maxScore: 4,
          currentTier: 1,
          remainingInTier: 2,
          dropoffPoints: 0,
          meaningfulCliff: false,
          costOfWaiting: 0,
          materiallyChangedOrdering: false,
        },
        draftTiming: {
          score: 2.1,
          minScore: 0,
          maxScore: 4,
          nextPickNumber: 13,
          nextPickLabel: '2.03',
          picksUntilNextPick: 5,
          returnProbability: 0.05,
          candidateValue: 24,
          expectedAlternative: {
            playerId: 'fallback-rb',
            playerName: 'Fallback RB',
            position: 'RB',
            ecrRank: 20,
            valueOverReplacement: 8,
            returnProbability: 0.8,
            expectedValue: 6.4,
          },
          costOfWaiting: 16.7,
          source: 'league-history',
          materiallyChangedOrdering: true,
        },
        conservativeBoundary: {
          ecrRankLimit: 9,
          samePositionTier: false,
          withinBoundary: true,
          feasibilityException: false,
        },
      },
    };

    const explanation = getRecommendationExplanation(recommendation);

    expect(explanation).toContain('5% Return Probability at pick 2.03');
    expect(explanation).toContain('Fallback RB is the expected RB fallback');
    expect(explanation).toContain('That next-pick tradeoff changed Best Pick.');
  });

  it('turns recommendation diagnostics into a plain-language decision', () => {
    const recommendation: Recommendation = {
      playerId: 'player-1',
      playerName: 'Ja\'Marr Chase',
      position: 'WR',
      reason: 'ECR champion',
      score: 100,
      diagnostics: {
        expertRank: 1,
        marketRank: 3,
        projectedPoints: 319,
        valueOverReplacement: 127,
        marketDelta: 2,
        nextPickSurvivalProbability: 0.14,
        tier: 1,
        tierRemaining: 1,
        isLastInTier: true,
      },
    };

    expect(getRecommendationExplanation(recommendation)).toBe(
      "Ja'Marr Chase is last available player in WR Tier 1 and +127 points above replacement. The chance this player reaches your next pick is only 14%, making waiting risky."
    );
  });

  it('explains when waiting is reasonable without contradicting the recommendation', () => {
    const recommendation: Recommendation = {
      playerId: 'player-1',
      playerName: 'Ja\'Marr Chase',
      position: 'WR',
      reason: 'ECR champion',
      score: 100,
      diagnostics: {
        expertRank: 1,
        marketRank: 3,
        projectedPoints: 337,
        valueOverReplacement: 133,
        marketDelta: 2,
        nextPickSurvivalProbability: 0.75,
        tier: 1,
        tierRemaining: 1,
        isLastInTier: true,
      },
    };

    expect(getRecommendationExplanation(recommendation)).toBe(
      "Ja'Marr Chase is last available player in WR Tier 1 and +133 points above replacement. The chance this player reaches your next pick is 75%, so waiting may be reasonable."
    );
  });

  it('describes a multi-player tier as a grammatical player attribute', () => {
    const recommendation: Recommendation = {
      playerId: 'player-2',
      playerName: 'Jahmyr Gibbs',
      position: 'RB',
      reason: 'ECR champion',
      score: 95,
      diagnostics: {
        expertRank: 3,
        marketRank: 4,
        projectedPoints: 310,
        valueOverReplacement: 120,
        marketDelta: 1,
        nextPickSurvivalProbability: 0.85,
        tier: 1,
        tierRemaining: 2,
      },
    };

    expect(getRecommendationExplanation(recommendation)).toContain(
      'Jahmyr Gibbs is one of 2 players remaining in RB Tier 1'
    );
  });
});
