import { describe, expect, it } from 'vitest';
import { reconcileComparisonSelection, resolveAssistantComparison } from './comparison-selection';

describe('side-panel comparison selection', () => {
  it('waits for recommendations before choosing the initial pair', () => {
    expect(reconcileComparisonSelection(null, [])).toBeNull();
    expect(reconcileComparisonSelection(null, ['a', 'b', 'c'])).toEqual(['a', 'b']);
  });

  it('preserves user choices and their identity across reordered recommendations', () => {
    const selected = ['c', 'a'];
    expect(reconcileComparisonSelection(selected, ['b', 'a', 'c'])).toBe(selected);
  });

  it('retains remaining choices when a selected player leaves the pool', () => {
    expect(reconcileComparisonSelection(['c', 'a'], ['b', 'a'])).toEqual(['a']);
  });

  it('selects a new pair when none of the previous choices remain available', () => {
    expect(reconcileComparisonSelection(['c', 'd'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('preserves an intentionally cleared selection', () => {
    const selected: readonly string[] = [];
    expect(reconcileComparisonSelection(selected, ['a', 'b'])).toBe(selected);
  });
});

describe('resolveAssistantComparison', () => {
  const [a, b, c] = [{ playerId: 'a', playerName: 'A' }, { playerId: 'b', playerName: 'B' }, { playerId: 'c', playerName: 'C' }];
  const drafted = (id: string) => id === 'c';

  it('keeps the requested opponent while it is available', () => {
    expect(resolveAssistantComparison({ subject: b, requested: c, selected: [b, c], recommendations: [a, b, c], isDrafted: () => false }))
      .toEqual({ comparison: c, notice: null });
  });

  it('never pairs B with B when C is drafted while A leads, and says who replaced C', () => {
    const result = resolveAssistantComparison({ subject: b, requested: c, selected: [b], recommendations: [a, b], isDrafted: drafted });
    expect(result.comparison).toBe(a);
    expect(result.notice).toBe('C was drafted. Comparing B with A instead.');
  });

  it('falls back to a solo explanation when no other player is left', () => {
    const result = resolveAssistantComparison({ subject: b, requested: c, selected: [b], recommendations: [b], isDrafted: drafted });
    expect(result.comparison).toBeUndefined();
    expect(result.notice).toBe('C was drafted. Showing B on their own.');
  });

  it('without a request, compares the subject with another player, never itself', () => {
    expect(resolveAssistantComparison({ subject: a, requested: null, selected: [a, b], recommendations: [a, b, c], isDrafted: () => false }).comparison).toBe(b);
    expect(resolveAssistantComparison({ subject: a, requested: a, selected: [a], recommendations: [a], isDrafted: () => false }))
      .toEqual({ comparison: undefined, notice: null });
  });
});
