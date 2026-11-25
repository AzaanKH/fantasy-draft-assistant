import { describe, expect, it } from 'vitest';
import type { PositionNeed, Recommendation } from '@fantasy-draft/shared/draft';
import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import { getTakeOrWaitVerdict } from '@/features/draft-room/suggestion-reasons';
import { getAnswerHeadline, getCompactDecisionExplanation, getNeedDescription, getNeedLabel, getWaitAnswer } from './sidepanel-insights';

const verdict = (survival: number, costOfWaiting: number | null = 1) => getTakeOrWaitVerdict({ survival, nextPickLabel: '2.08', tierEnds: false, costOfWaiting });
const need = (startersFilled: number, startersNeeded: number, flex: Partial<PositionNeed> = {}) =>
  ({ position: 'RB', startersFilled, startersNeeded, isFlexEligible: false, flexSlotsFilled: 0, flexSlotsNeeded: 0, priority: 'low', ...flex }) as PositionNeed;

describe('the side panel answer, from the shared verdict', () => {
  it('says Take now on your own pick, never "if available"', () => {
    expect(getAnswerHeadline({ name: 'Bijan Robinson', verdict: verdict(0.2), onClock: true, explainsComparison: false })).toBe('Take Bijan Robinson now.');
    expect(getAnswerHeadline({ name: 'Bijan Robinson', verdict: verdict(0.2), onClock: false, explainsComparison: false })).toBe('Take Bijan Robinson if available.');
  });

  it('uses the shared 50% rule, so 45% is take-now and 55% is not', () => {
    expect(getAnswerHeadline({ name: 'A', verdict: verdict(0.45), onClock: true, explainsComparison: false })).toBe('Take A now.');
    expect(getAnswerHeadline({ name: 'A', verdict: verdict(0.55), onClock: true, explainsComparison: false })).toBe('A is the best current option.');
  });

  it('answers Can I wait? in the verdict\'s words', () => {
    expect(getWaitAnswer(verdict(0.2), false)).toBe('No. Likely gone by 2.08.');
    expect(getWaitAnswer(verdict(0.9, 0), false)).toBe('Yes. Likely still there at 2.08, and waiting costs little.');
    expect(getWaitAnswer(verdict(0.9, 40), false)).toBe('Probably. Likely still there at 2.08, but waiting has a real cost.');
    expect(getWaitAnswer(null, true)).toMatch(/final pick/);
  });
});

describe('roster need wording', () => {
  it('uses the web app\'s open / filled words, never a verdict label or a priority', () => {
    expect(getNeedLabel(need(0, 2))).toBe('2 open');
    expect(getNeedLabel(need(1, 1, { isFlexEligible: true, flexSlotsNeeded: 1 }))).toBe('FLEX open');
    expect(getNeedLabel(need(1, 1))).toBe('Filled');
    expect(getNeedDescription(need(1, 2))).toBe('1 / 2 filled');
    for (const label of [getNeedLabel(need(0, 2)), getNeedLabel(need(1, 1)), getNeedDescription(need(1, 1))]) {
      expect(label).not.toMatch(/Can wait|Critical|High|Later|miss chance/);
    }
  });
});

describe('the compact decision explanation, per Decision Lens', () => {
  // A pick Best Pick's timing factor moved up: the flag belongs to Best Pick, not to the active lens.
  const timedPick = {
    playerId: 'rb', playerName: 'Timed Back', position: 'RB', reason: 'test', score: 1,
    diagnostics: {
      expertRank: asRank(3), marketRank: 3, projectedPoints: 240, valueOverReplacement: asVor(40), marketDelta: 0,
      nextPickSurvivalProbability: asProbability(0.05), nextPickNumber: 13, nextPickLabel: '2.03',
    },
    decisionFactors: {
      draftTiming: {
        score: 2.1, minScore: 0, maxScore: 4, nextPickNumber: 13, nextPickLabel: '2.03', picksUntilNextPick: 5,
        returnProbability: asProbability(0.05), candidateValue: 24, costOfWaiting: 16.7, source: 'league-history',
        materiallyChangedOrdering: true,
        expectedAlternative: { playerId: 'alt', playerName: 'Fallback Back', expectedValue: 10 },
      },
    },
  } as unknown as Recommendation;

  it('leads a Ranked Fit pick with the Ranked Fit rule and labels the timing as Best Pick analysis', () => {
    const explanation = getCompactDecisionExplanation(timedPick, 'ranked-fit');
    expect(explanation).toBe(
      'Ranked Fit orders the players who keep a legal roster possible by the rankings alone. Best Pick analysis: If you wait, Fallback Back is the likely RB at 2.03.'
    );
    expect(explanation).not.toMatch(/moved this pick/);
  });

  it('keeps the timing flag in Best Pick, whose order it set', () => {
    expect(getCompactDecisionExplanation(timedPick, 'best-pick')).toBe('If you wait, Fallback Back is the likely RB at 2.03. Timing moved this pick up.');
  });
});
