import { asProbability, asRank, asVor } from '../../units/brands.js';
import { describe, expect, it } from 'vitest';
import type { PositionNeed, Recommendation } from '../../draft.js';
import type { DraftDecisionView } from '../recommendations/draft-decision.js';
import {
  getComparisonHighlights,
  getRosterAnswer,
  getWaitAnswer,
  getWaitingCostSummary,
  getWhyRows,
} from './assistant-analysis.js';

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
      expertRank: asRank(expertRank),
      marketRank: 5,
      marketDelta: 1,
      projectedPoints: 230,
      valueOverReplacement: asVor(valueOverReplacement),
      tier: 1,
      tierRemaining: 2,
      nextPickSurvivalProbability: asProbability(returnProbability),
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
        playerQuality: { ecrRank: asRank(4), score: -4 },
        leagueValue: {
          score: 1,
          minScore: 0,
          maxScore: 6,
          projectedPoints: 230,
          replacementPoints: 206,
          valueOverReplacement: asVor(24),
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
          returnProbability: asProbability(0.05),
          candidateValue: 24,
          expectedAlternative: {
            playerId: 'fallback-rb',
            playerName: 'Fallback RB',
            position: 'RB',
            ecrRank: asRank(18),
            valueOverReplacement: asVor(8),
            returnProbability: asProbability(0.8),
            expectedValue: 6.4,
          },
          costOfWaiting: 17.6,
          source: 'league-history',
          materiallyChangedOrdering: true,
        },
        conservativeBoundary: {
          ecrRankLimit: asRank(9),
          samePositionTier: false,
          withinBoundary: true,
          feasibilityException: false,
        },
      },
    };

    const why = getWhyRows(selected, true);
    expect(why.map((row) => row.label)).toEqual(['Value', 'Roster fit', 'Tier', 'Why it ranks here']);
    expect(why[0]?.answer).toMatch(/24 pts.*#4 overall/);
    expect(why[1]?.answer).toMatch(/3 starter.*2 FLEX.*10 selections/);
    expect(why[3]?.answer).toMatch(/cost of waiting/i);
    expect(why.some((row) => row.answer.includes('17.6'))).toBe(false);
    const level = getWhyRows({ ...selected, diagnostics: selected.diagnostics ? { ...selected.diagnostics, valueOverReplacement: asVor(0.2) } : undefined }, true);
    expect(level[0]?.answer).toMatch(/about the same/);
    expect(level[0]?.answer).not.toMatch(/0\.2/);

    const wait = getWaitAnswer(selected);
    expect(wait.headline).toMatch(/unlikely.*2\.03/i);
    expect(wait.rows.map((row) => row.label)).toEqual(['At next pick', 'Waiting cost', 'Expected Next-Pick Alternative']);
    expect(wait.rows[0]?.answer).toContain('5%');
    expect(wait.rows[1]?.answer).toContain('17.6');
    expect(wait.rows[2]?.answer).toMatch(/Fallback RB.*\+6/);
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
    expect([wait.headline, wait.rows[0]?.answer, wait.rows[1]?.answer]).toEqual([
      expect.stringMatching(/unavailable/i), expect.stringMatching(/unavailable/i), expect.stringMatching(/unavailable/i),
    ]);
    expect(wait.rows.some((row) => /\b0\b/.test(row.answer))).toBe(false);
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

    const highlights = getComparisonHighlights(first, second, decision);
    expect(highlights.map((row) => row.label)).toEqual(['League value', 'Wait risk', 'Player quality']);
    expect(highlights[0]?.detail).toMatch(/First RB.* 12 more pts/);
    expect(highlights[1]?.detail).toMatch(/First RB.* 45 percentage points less likely/);
    expect(highlights[2]?.detail).toMatch(/First RB.*#4.* 4 places ahead/);

    const fractionalValue = recommendation('second', 'Second RB', 25.5, 0.65, 8);
    expect(getComparisonHighlights(first, fractionalValue, decision)[0]?.detail)
      .toMatch(/ 4\.5 more pts/);
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
    expect(answer.headline).toMatch(/open WR starter/);
    expect(answer.openStarters).toMatch(/WR.*FLEX ×2/);
    expect(answer.slots).toMatch(/1 of 2.*FLEX 0 of 2/);
  });

  it('fills an open FLEX slot once fixed starters are filled', () => {
    const answer = getRosterAnswer(needs({}, 0), 'WR');
    expect(answer.headline).toMatch(/open FLEX starter/);
    expect(answer.openStarters).not.toContain('WR');
    expect(answer.slots).toMatch(/2 of 2.*FLEX 0 of 2/);
  });

  it('adds depth only when fixed and FLEX starters are filled', () => {
    const answer = getRosterAnswer(needs({}, 2), 'WR');
    expect(answer.headline).toMatch(/depth/);
    expect(answer.openStarters).toMatch(/all starter slots are filled/i);
    expect(getRosterAnswer(needs({}, 0), 'QB').headline).toMatch(/QB starters are filled.*depth/);
  });
});
