import { describe, expect, it } from 'vitest';
import { createDraftDisplayContext } from '../../draft/display-context.js';
import { createSafeRecommendationPolicy, SAFE_RECOMMENDATION_POLICY } from './policy.js';

describe('safe policy display context', () => {
  it('names the ranking source the display uses and defaults to the live display', () => {
    const live = createSafeRecommendationPolicy(createDraftDisplayContext(false));
    const demo = createSafeRecommendationPolicy(createDraftDisplayContext(true));
    expect(live.reason).toMatch(/ECR/);
    expect(demo.reason).toMatch(/model rank/);
    expect({ ...demo, reason: live.reason }).toEqual(live);
    expect(SAFE_RECOMMENDATION_POLICY).toEqual(live);
  });
});
