import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { VISUAL_PLAYER_DATA } from '@/visual/VisualApp';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Recommendation,
  RecommendationDecisionFactors,
} from '@fantasy-draft/shared/draft';
import { DraftDecisionBar } from './DraftDecisionBar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getDraftDecisionBarReason } from './draft-decision-bar-reason';

vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ ...VISUAL_PLAYER_DATA, isLoading: decision.playersLoading }) }));

const decision = vi.hoisted(() => ({
  output: { bestPick: null as Recommendation | null },
  isLoading: true,
  recommendationsBlocked: false,
  playersLoading: false,
}));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => decision,
}));
vi.mock('@/hooks/useQueueActions', () => ({
  useQueueActions: () => ({ togglePlayerQueued: vi.fn() }),
}));

describe('DraftDecisionBar loading', () => {
  afterEach(() => { Object.assign(decision, { isLoading: true, recommendationsBlocked: false, playersLoading: false }); });

  it('keeps the settled pick visible while loading', () => {
    decision.output.bestPick = recommendation();
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(DraftDecisionBar, { onOpenAssistant: vi.fn() })));
    expect(markup).toContain('Why this pick');
    expect(markup).toContain('Add Best Pick to the local queue');
  });

  it('reports loading, not a paused setup, while player data loads', () => {
    decision.output.bestPick = null;
    decision.isLoading = false;
    decision.recommendationsBlocked = true;
    decision.playersLoading = true;
    const markup = renderToStaticMarkup(createElement(DraftDecisionBar, { onOpenAssistant: vi.fn() }));
    expect(markup).toContain('Finding your best pick');
    expect(markup).not.toContain('Paused until setup');
  });

  it('shows loading feedback in the same bar before the first pick', () => {
    decision.output.bestPick = null;
    const markup = renderToStaticMarkup(createElement(DraftDecisionBar, { onOpenAssistant: vi.fn() }));
    expect(markup).toContain('class="draft-best-pick-inline"');
    expect(markup).toContain('Finding your best pick');
  });
});

function decisionFactors(): RecommendationDecisionFactors {
  return {
    playerQuality: { ecrRank: asRank(8), score: -8 },
    leagueValue: {
      score: 2,
      minScore: 0,
      maxScore: 6,
      projectedPoints: 240,
      replacementPoints: 200,
      valueOverReplacement: asVor(40),
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
      returnProbability: asProbability(0.18),
      candidateValue: 40,
      costOfWaiting: 16.5,
      materiallyChangedOrdering: false,
    },
    conservativeBoundary: {
      ecrRankLimit: asRank(9),
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
      leagueValue: { ...factors.leagueValue, valueOverReplacement: asVor(value) },
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

function renderToStaticMarkup(element: ReactElement): string {
  return renderMarkup(createElement(WorkspaceTestProvider, {store: createDraftStore(), children: element}));
}
