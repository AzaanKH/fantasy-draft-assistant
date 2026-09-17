import { describe, expect, it } from 'vitest';
import { reconcileComparisonSelection } from './comparison-selection';

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
