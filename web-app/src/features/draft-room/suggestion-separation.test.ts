import { describe, expect, it } from 'vitest';
import { formatGapToTop, getGapsToTop } from './suggestion-separation';

const suggestions = (...vors: (number | undefined)[]) => vors.map((valueOverReplacement, index) => ({ playerId: `p${String(index + 1)}`, valueOverReplacement }));
const lines = (gaps: ReadonlyMap<string, { vorDelta: number; versus: 1 | 2 } | null>) => [...gaps.values()].map((gap) => gap && formatGapToTop(gap));

describe('getGapsToTop', () => {
  it('compares #1 with #2 and every other card with #1, so no two cards say the same thing', () => {
    expect(lines(getGapsToTop(suggestions(114, 102, 98, 90)))).toEqual(['+12 pts over #2', '12 pts behind #1', '16 pts behind #1', '24 pts behind #1']);
  });

  it('reports near-ties as ties instead of a clear pick', () => {
    expect(lines(getGapsToTop(suggestions(10, 9.9, 9.8, 9.7)))).toEqual(['Even with #2', 'Even with #1', 'Even with #1', 'Even with #1']);
  });

  it('keeps evenly spaced values as evenly spaced gaps, with no strength judgement', () => {
    expect([...getGapsToTop(suggestions(40, 30, 20, 10)).values()].map((gap) => gap?.vorDelta ?? null)).toEqual([10, -10, -20, -30]);
  });

  it('says when a later card has more value than #1', () => {
    expect(lines(getGapsToTop(suggestions(20, 25)))).toEqual(['5 pts behind #2', '+5 pts over #1']);
  });

  it('shows nothing when a value is missing or there is no other card', () => {
    const gaps = getGapsToTop(suggestions(undefined, 10));
    expect([...gaps.values()]).toEqual([null, null]);
    expect(getGapsToTop(suggestions(12)).get('p1')).toBeNull();
  });
});
