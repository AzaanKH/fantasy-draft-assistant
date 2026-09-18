import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  Recommendation,
  RecommendationDecisionFactors,
} from '@fantasy-draft/shared';
import { DraftDecisionBar } from './DraftDecisionBar';
import { getDraftDecisionBarReason } from './draft-decision-bar-reason';

const decision = vi.hoisted(() => ({
  output: { bestPick: null as Recommendation | null },
  isLoading: true,
}));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => decision,
}));
vi.mock('@/hooks/useQueueActions', () => ({
  useQueueActions: () => ({ togglePlayerQueued: vi.fn() }),
}));

describe('DraftDecisionBar loading', () => {
  it.each([true, false])('keeps the settled pick visible while loading, compact=%s', (compact) => {
    decision.output.bestPick = recommendation();
    const markup = renderToStaticMarkup(createElement(DraftDecisionBar, { compact, onOpenAssistant: vi.fn() }));
    expect(markup).toContain(compact ? 'Why this pick' : 'Assistant');
    expect(markup).toContain('Add Best Pick to the local queue');
  });

  it('hides the empty compact bar but retains the full loading skeleton', () => {
    decision.output.bestPick = null;
    expect(renderToStaticMarkup(createElement(DraftDecisionBar, { compact: true, onOpenAssistant: vi.fn() }))).toBe('');
    expect(renderToStaticMarkup(createElement(DraftDecisionBar, { onOpenAssistant: vi.fn() }))).toContain('Loading the current Best Pick');
  });
});

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
    depthValue: {
      score: 0,
      minScore: 0,
      maxScore: 4,
      positionCount: 0,
      startersAtPosition: 0,
      reserveCount: 0,
      targetReserveCount: 2,
      reserveDeficit: 2,
      contingencyPoints: 0,
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
    expect(getDraftDecisionBarReason(recommendation({
      ...decisionFactors(),
      depthValue: {
        ...decisionFactors().depthValue,
        score: 4,
        reserveCount: 0,
        targetReserveCount: 2,
        reserveDeficit: 2,
        contingencyPoints: 20,
        materiallyChangedOrdering: true,
      },
    }), 'depth-value')).toBe(
      'Depth Value moves RB first with 0 reserves against a target of 2.'
    );
  });

  it.each([40, -12])('uses neutral replacement wording for signed VOR %s', (value) => {
    const factors = decisionFactors();
    const pick = recommendation({
      ...factors,
      leagueValue: { ...factors.leagueValue, valueOverReplacement: value },
    });
    const signedValue = value > 0 ? `+${String(value)}` : String(value);

    expect(getDraftDecisionBarReason(pick, 'league-value')).toBe(
      `League value moves this pick first at ${signedValue} points versus replacement.`
    );
    expect(getDraftDecisionBarReason(pick)).toBe(
      `ECR #8 with ${signedValue} points versus replacement.`
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
