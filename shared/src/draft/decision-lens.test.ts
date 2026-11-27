import { describe, expect, it } from 'vitest';
import { DECISION_LENSES, DEFAULT_DECISION_LENS, resolveSavedDecisionLens } from './decision-lens.js';

describe('Decision Lens default', () => {
  it('is Ranked Fit, listed first, with Best Pick and Best Player still selectable', () => {
    expect(DEFAULT_DECISION_LENS).toBe('ranked-fit');
    expect(DECISION_LENSES).toEqual(['ranked-fit', 'best-pick', 'best-player']);
  });

  it('gives a missing preference the default', () => {
    expect(resolveSavedDecisionLens(null)).toBe('ranked-fit');
    expect(resolveSavedDecisionLens(undefined)).toBe('ranked-fit');
    expect(resolveSavedDecisionLens({})).toBe('ranked-fit');
  });

  it('moves a legacy stored Best Pick, which was the old default, to Ranked Fit', () => {
    expect(resolveSavedDecisionLens({ decisionLens: 'best-pick' })).toBe('ranked-fit');
  });

  it('keeps a legacy Best Player, which was always a choice', () => {
    expect(resolveSavedDecisionLens({ decisionLens: 'best-player' })).toBe('best-player');
  });

  it('honours every lens saved under the Ranked Fit default', () => {
    for (const lens of DECISION_LENSES) {
      expect(resolveSavedDecisionLens({ decisionLens: lens, decisionLensDefault: 'ranked-fit' })).toBe(lens);
    }
  });
});
