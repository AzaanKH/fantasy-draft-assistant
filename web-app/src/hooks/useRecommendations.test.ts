import { describe, expect, it } from 'vitest';
import { hasRemainingDraftDecision } from './useRecommendations';

describe('recommendation horizon', () => {
  it('stops at roster capacity even when the draft has more rounds', () => {
    expect(hasRemainingDraftDecision(120, 140, 13, 13)).toBe(false);
  });

  it('keeps recommendations enabled while a roster slot remains', () => {
    expect(hasRemainingDraftDecision(120, 140, 13, 14)).toBe(true);
  });
});
