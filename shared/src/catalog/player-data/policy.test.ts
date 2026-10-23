import { describe, expect, it } from 'vitest';
import { createDraftDisplayContext } from '../../draft/display-context.js';
import { createSafeRecommendationPolicy, SAFE_RECOMMENDATION_POLICY } from './policy.js';

describe('safe policy display context', () => {
  it('preserves live and demo fallback labels without changing the default', () => {
    const live = createSafeRecommendationPolicy(createDraftDisplayContext(false));
    const demo = createSafeRecommendationPolicy(createDraftDisplayContext(true));
    expect(live.reason).toBe('Recommendation policy unavailable; using the safe ECR fallback.');
    expect(demo.reason).toBe('Recommendation policy unavailable; using the safe model rank fallback.');
    expect(createSafeRecommendationPolicy()).toEqual(live);
    expect(SAFE_RECOMMENDATION_POLICY).toEqual(live);
    expect({ ...demo, reason: live.reason }).toEqual(live);
  });
});
