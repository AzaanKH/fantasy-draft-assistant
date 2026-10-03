import { describe, expect, it } from 'vitest';
import type { PositionNeed, Recommendation } from '@fantasy-draft/shared';
import type { DraftDecisionView } from '@/features/recommendations/draft-decision';
import {
  getComparisonHighlights,
  getRosterAnswer,
  getWaitAnswer,
  getWaitingCostSummary,
  getWhyRows,
} from './assistant-analysis';

function recommendation(
  playerId: string,
  playerName: string,
  valueOverReplacement: number,
  returnProbability: number,
  expertRank: number = 4
): Recommendation {
  return {
    playerId,
    playerName,
    position: 'RB',
    reason: 'Next-pick timing',
    score: 10,
    diagnostics: {
      expertRank,
      marketRank: 5,
      marketDelta: 1,
      projectedPoints: 230,
      valueOverReplacement,
      tier: 1,
      tierRemaining: 2,
      nextPickSurvivalProbability: returnProbability,
      nextPickNumber: 13,
      nextPickLabel: '2.03',
    },
  };
}

describe('Assistant decision answer', () => {
  it('splits value, roster and tier from timing and states each figure once', () => {
    const base = recommendation('urgent-rb', 'Urgent RB', 24, 0.05);
    const selected: Recommendation = {
      ...base,
      decisionFactors: {
        playerQuality: { ecrRank: 4, score: -4 },
        leagueValue: {
          score: 1,
          minScore: 0,
          maxScore: 6,
          projectedPoints: 230,
          replacementPoints: 206,
          valueOverReplacement: 24,
          materiallyChangedOrdering: false,
        },
        rosterFit: {
          score: 4,
          minScore: 0,
          maxScore: 8,
          fixedStartersOpen: 3,
          flexSlotsOpen: 2,
          benchSlotsOpen: 5,
          selectionsRemaining: 10,
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
          score: 3,
          minScore: 0,
          maxScore: 4,
          nextPickNumber: 13,
          nextPickLabel: '2.03',
          returnProbability: 0.05,
          candidateValue: 24,
          expectedAlternative: {
            playerId: 'fallback-rb',
            playerName: 'Fallback RB',
            position: 'RB',
            ecrRank: 18,
            valueOverReplacement: 8,
            returnProbability: 0.8,
            expectedValue: 6.4,
          },
          costOfWaiting: 17.6,
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

    const why = getWhyRows(selected, true);
    expect(why.map((row) => row.label)).toEqual(['Value', 'Roster fit', 'Tier', 'Why it ranks here']);
    expect(why[0]?.answer).toBe('VOR +24. ECR #4.');
    expect(why[1]?.answer).toBe('3 starter spots and 2 FLEX spots open, 10 selections left.');
    expect(why[3]?.answer).toBe('Draft timing changed the order. Can I wait? shows the cost.');
    expect(why.some((row) => row.answer.includes('17.6'))).toBe(false);

    const wait = getWaitAnswer(selected);
    expect(wait.headline).toBe('Unlikely to return at pick 2.03.');
    expect(wait.rows.map((row) => [row.label, row.answer])).toEqual([
      ['At next pick', '5% Return Probability'],
      ['Waiting cost', '17.6 expected points'],
      ['Expected Next-Pick Alternative', 'Fallback RB, +6 expected points above replacement'],
    ]);
    expect(getWaitingCostSummary(selected)).toEqual({
      costOfWaiting: 17.6,
      nextPickLabel: '2.03',
      fallbackName: 'Fallback RB',
      fallbackValue: 6.4,
    });
  });

  it('shows missing timing as unavailable, never as zero', () => {
    const { nextPickSurvivalProbability: _omitted, ...diagnostics } = recommendation('rb', 'Unknown RB', 10, 0.5).diagnostics ?? {};
    const unknownTiming: Recommendation = {
      ...recommendation('rb', 'Unknown RB', 10, 0.5),
      diagnostics: { ...diagnostics, nextPickCostOfWaiting: 4 } as Recommendation['diagnostics'],
    };
    const wait = getWaitAnswer(unknownTiming);
    expect(wait.headline).toBe('Waiting risk is unavailable.');
    expect(wait.rows[0]?.answer).toBe('Unavailable. Timing inputs are missing.');
    expect(wait.rows[1]?.answer).toBe('Unavailable');
    expect(getWaitingCostSummary(unknownTiming).costOfWaiting).toBeNull();
  });

  it('calls out the material gaps before the full comparison', () => {
    const first = recommendation('first', 'First RB', 30, 0.2);
    const second = recommendation('second', 'Second RB', 18, 0.65, 8);
    const decision: DraftDecisionView = {
      recommendations: [first, second],
      preferred: first,
      preferredPlayerId: first.playerId,
      rankByPlayerId: new Map([
        [first.playerId, 1],
        [second.playerId, 3],
      ]),
      explanationByPlayerId: new Map(),
      selection: {
        preferredPlayerId: first.playerId,
        policy: 'primary-league-policy',
      },
    };

    expect(getComparisonHighlights(first, second, decision)).toEqual([
      {
        label: 'League value',
        detail: 'First RB has 12 more projected points above replacement.',
      },
      {
        label: 'Wait risk',
        detail: 'First RB is 45 percentage points less likely to reach your next pick.',
      },
      {
        label: 'Player quality',
        detail: 'First RB is ECR #4, 4 places ahead.',
      },
    ]);

    const fractionalValue = recommendation('second', 'Second RB', 25.5, 0.65, 8);
    expect(getComparisonHighlights(first, fractionalValue, decision)[0]?.detail)
      .toBe('First RB has 4.5 more projected points above replacement.');
  });
});

describe('What does my roster need?', () => {
  const needs = (fixed: Partial<Record<'RB' | 'WR' | 'TE', number>>, flexSlotsFilled: number): PositionNeed[] =>
    (['QB', 'RB', 'WR', 'TE'] as const).map((position) => ({
      position,
      priority: 'medium',
      startersNeeded: position === 'QB' || position === 'TE' ? 1 : 2,
      startersFilled: (position === 'QB' ? 1 : fixed[position]) ?? (position === 'TE' ? 1 : 2),
      flexSlotsNeeded: 2,
      flexSlotsFilled,
      isFlexEligible: position !== 'QB',
      scarcityScore: 5,
    }));

  it('fills an open fixed starter slot first', () => {
    const answer = getRosterAnswer(needs({ WR: 1 }, 0), 'WR');
    expect(answer.headline).toBe('Fills an open WR starter slot.');
    expect(answer.openStarters).toBe('WR, FLEX ×2');
    expect(answer.slots).toBe('1 of 2 filled · FLEX 0 of 2 filled · medium need');
  });

  it('fills an open FLEX slot once fixed starters are filled', () => {
    const answer = getRosterAnswer(needs({}, 0), 'WR');
    expect(answer.headline).toBe('Fills an open FLEX starter slot.');
    expect(answer.openStarters).toBe('FLEX ×2');
    expect(answer.slots).toBe('2 of 2 filled · FLEX 0 of 2 filled · medium need');
  });

  it('adds depth only when fixed and FLEX starters are filled', () => {
    const answer = getRosterAnswer(needs({}, 2), 'WR');
    expect(answer.headline).toBe('WR and FLEX starters are filled. This adds depth.');
    expect(answer.openStarters).toBe('All starter slots are filled.');
    expect(getRosterAnswer(needs({}, 0), 'QB').headline).toBe('QB starters are filled. This adds depth.');
  });
});
