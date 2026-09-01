import { describe, expect, it } from 'vitest';
import type { Recommendation } from '@fantasy-draft/shared';
import type { DraftDecisionView } from '@/features/recommendations/draft-decision';
import {
  getAssistantAnswerSections,
  getComparisonHighlights,
} from './AssistantPage';

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
  it('leads with the four decision questions and keeps each answer concise', () => {
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

    const sections = getAssistantAnswerSections(selected, true);

    expect(sections.map((section) => section.label)).toEqual([
      'Why now',
      'Risk of waiting',
      'Best fallback',
      'What changed the recommendation',
    ]);
    expect(sections[0]?.answer).toBe('Waiting costs 17.6 expected points on Urgent RB.');
    expect(sections[1]?.answer).toBe(
      'Only 5% Return Probability at pick 2.03. Waiting costs 17.6 expected points.'
    );
    expect(sections[2]?.answer).toContain('Fallback RB is the Expected Next-Pick Alternative');
    expect(sections[3]?.answer).toBe(
      'Draft timing changed the order because waiting costs 17.6 expected points.'
    );
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
  });
});
