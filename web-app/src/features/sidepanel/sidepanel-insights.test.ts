import { describe, expect, it } from 'vitest';
import type { PositionNeed } from '@fantasy-draft/shared/draft';
import { getTakeOrWaitVerdict } from '@/features/draft-room/suggestion-reasons';
import { getAnswerHeadline, getNeedDescription, getNeedLabel, getWaitAnswer } from './sidepanel-insights';

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
