import { asProbability, asRank, asVor } from '../../units/brands.js';
import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../../draft.js';
import { getRecommendationExplanation } from './recommendation-explanation.js';

type Factors = NonNullable<Recommendation['decisionFactors']>;

/** Neutral policy factors: every group scores 0 and changes nothing, so each case overrides only what it explains. */
function factors(ecrRank: number, points: number, overrides: Partial<Factors> = {}): Factors {
  return {
    playerQuality: { ecrRank: asRank(ecrRank), score: -ecrRank },
    leagueValue: { score: 0, minScore: 0, maxScore: 6, projectedPoints: points, replacementPoints: points, valueOverReplacement: asVor(0) },
    rosterFit: {
      score: 6, minScore: 0, maxScore: 8, fixedStartersOpen: 7, flexSlotsOpen: 2, benchSlotsOpen: 5,
      selectionsRemaining: 14, legalCompletionPossible: true,
    },
    depthValue: {
      score: 0, minScore: 0, maxScore: 4, positionCount: 0, startersAtPosition: 0, reserveCount: 0,
      targetReserveCount: 0, reserveDeficit: 0, contingencyPoints: 0, materiallyChangedOrdering: false,
    },
    tierSupply: {
      score: 0, minScore: 0, maxScore: 4, currentTier: 1, remainingInTier: 2, dropoffPoints: 0,
      meaningfulCliff: false, costOfWaiting: 0, materiallyChangedOrdering: false,
    },
    draftTiming: { score: 0, minScore: 0, maxScore: 4, candidateValue: 0, costOfWaiting: 0, materiallyChangedOrdering: false },
    conservativeBoundary: { ecrRankLimit: asRank(ecrRank + 6), samePositionTier: false, withinBoundary: true, feasibilityException: false },
    ...overrides,
  };
}

function recommendation(
  position: Recommendation['position'],
  ecrRank: number,
  points: number,
  overrides: Partial<Factors> | undefined,
  diagnostics: Partial<NonNullable<Recommendation['diagnostics']>> = {},
): Recommendation {
  return {
    playerId: 'player',
    playerName: 'Test Player',
    position,
    reason: 'test',
    score: 1,
    diagnostics: {
      expertRank: asRank(ecrRank), marketRank: ecrRank, projectedPoints: points,
      valueOverReplacement: asVor(0), marketDelta: 0, tier: 1, ...diagnostics,
    },
    ...(overrides ? { decisionFactors: factors(ecrRank, points, overrides) } : {}),
  };
}

describe('getRecommendationExplanation', () => {
  it('explains when thin positional coverage adds Depth Value', () => {
    const explanation = getRecommendationExplanation(recommendation('RB', 102, 200, {
      depthValue: {
        score: 4, minScore: 0, maxScore: 4, positionCount: 2, startersAtPosition: 2, reserveCount: 0,
        targetReserveCount: 2, reserveDeficit: 2, contingencyPoints: 50, materiallyChangedOrdering: true,
      },
    }));

    expect(explanation).toMatch(/Depth adds 4\.0/);
    expect(explanation).toMatch(/0 RB reserves against a target of 2/);
    expect(explanation).toMatch(/changed Best Pick/);
  });

  it('names the policy factors and the legal-roster exception from the decision output', () => {
    const explanation = getRecommendationExplanation(recommendation('K', 30, 130, {
      leagueValue: { score: 0.5, minScore: 0, maxScore: 6, projectedPoints: 130, replacementPoints: 118, valueOverReplacement: asVor(12) },
      rosterFit: {
        score: 8, minScore: 0, maxScore: 8, fixedStartersOpen: 1, flexSlotsOpen: 0, benchSlotsOpen: 0,
        selectionsRemaining: 1, legalCompletionPossible: true,
      },
      conservativeBoundary: { ecrRankLimit: asRank(9), samePositionTier: false, withinBoundary: false, feasibilityException: true },
    }, { valueOverReplacement: asVor(12) }));

    expect(explanation).toMatch(/#30/);
    expect(explanation).toMatch(/value adds 0\.5/);
    expect(explanation).toMatch(/Roster fit adds 8\.0/);
    expect(explanation).toMatch(/roster fillable/);
    // Plain words only: no model jargon in the full reasoning.
    expect(explanation).not.toMatch(/policy point|replacement|Return Probability|anchored/i);
  });

  it('explains the tier supply factor when it changes Best Pick', () => {
    const explanation = getRecommendationExplanation(recommendation('RB', 3, 220, {
      tierSupply: {
        score: 4, minScore: 0, maxScore: 4, currentTier: 1, remainingInTier: 1, nextTier: 2, nextTierProjectedPoints: 180,
        dropoffPoints: 40, meaningfulCliff: true, costOfWaiting: 4, materiallyChangedOrdering: true,
      },
    }, { tierRemaining: 1, tierDropoffPoints: 40, costOfWaiting: 4 }));

    expect(explanation).toMatch(/adds 4\.0 with 1 left in RB Tier 1/);
    expect(explanation).toMatch(/40\.0 point drop/);
    expect(explanation).toMatch(/changed Best Pick/);
  });

  it('names the next-pick window, expected fallback, and timing override', () => {
    const explanation = getRecommendationExplanation(recommendation('RB', 3, 240, {
      draftTiming: {
        score: 2.1, minScore: 0, maxScore: 4, nextPickNumber: 13, nextPickLabel: '2.03', picksUntilNextPick: 5,
        returnProbability: asProbability(0.05), candidateValue: 24,
        expectedAlternative: {
          playerId: 'fallback-rb', playerName: 'Fallback RB', position: 'RB', ecrRank: asRank(20),
          valueOverReplacement: asVor(8), returnProbability: asProbability(0.8), expectedValue: 6.4,
        },
        costOfWaiting: 16.7, source: 'league-history', materiallyChangedOrdering: true,
      },
    }, { nextPickSurvivalProbability: asProbability(0.05), nextPickNumber: 13, nextPickLabel: '2.03' }));

    expect(explanation).toMatch(/5%.*2\.03/);
    expect(explanation).toMatch(/Fallback RB/);
    expect(explanation).toMatch(/changed Best Pick/);
  });

  it('explains a Ranked Fit rank by the rankings and labels attached factors as Best Pick analysis', () => {
    const withFactors = recommendation('RB', 3, 240, {
      leagueValue: { score: 2.5, minScore: 0, maxScore: 6, projectedPoints: 240, replacementPoints: 200, valueOverReplacement: asVor(40) },
      draftTiming: {
        score: 2.1, minScore: 0, maxScore: 4, nextPickNumber: 13, nextPickLabel: '2.03', picksUntilNextPick: 5,
        returnProbability: asProbability(0.05), candidateValue: 24, costOfWaiting: 16.7, source: 'league-history',
        materiallyChangedOrdering: true,
      },
      conservativeBoundary: { ecrRankLimit: asRank(9), samePositionTier: false, withinBoundary: false, feasibilityException: true },
    });
    const explanation = getRecommendationExplanation(withFactors, undefined, 'ranked-fit');

    expect(explanation).toMatch(/^Test Player is #3 in the rankings\. Ranked Fit orders the players who keep a legal roster possible by the rankings alone\. Best Pick analysis, which does not change this order:/);
    expect(explanation).toMatch(/value adds 2\.5 to his Best Pick score/);
    expect(explanation).toMatch(/adds 2\.1 to his Best Pick score/);
    expect(explanation).not.toMatch(/to his score|taking him now|roster fillable/);
    // Best Pick keeps its own wording.
    expect(getRecommendationExplanation(withFactors)).toMatch(/value adds 2\.5 to his score/);
  });

  it.each([
    ['the last player in a tier, with risky waiting', 'WR', { tierRemaining: 1, isLastInTier: true, valueOverReplacement: asVor(127),
      nextPickSurvivalProbability: asProbability(0.14) }, [/last available player in WR Tier 1/, /\+127 pts/, /14%.*risky/]],
    ['the last player in a tier, with reasonable waiting', 'WR', { tierRemaining: 1, isLastInTier: true, valueOverReplacement: asVor(133),
      nextPickSurvivalProbability: asProbability(0.75) }, [/\+133 pts/, /75%.*reasonable/]],
    ['one of several players left in a tier', 'RB', { tierRemaining: 2, nextPickSurvivalProbability: asProbability(0.85) },
      [/one of 2 players remaining in RB Tier 1/]],
  ] as const)('explains diagnostics alone for %s', (_label, position, diagnostics, patterns) => {
    const explanation = getRecommendationExplanation(recommendation(position, 1, 300, undefined, diagnostics));
    for (const pattern of patterns) expect(explanation).toMatch(pattern);
  });
});
