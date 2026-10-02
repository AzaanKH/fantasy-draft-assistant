import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { LIVE_RECOMMENDATION_ARCHITECTURE } from '@fantasy-draft/shared';
import { SAFE_RECOMMENDATION_POLICY } from './policy';
import { isRecommendationPolicyFile } from './validators';

describe('runtime recommendation policy', () => {
  it('uses the active architecture in both saved configuration and the fallback', async () => {
    const policy: unknown = JSON.parse(await readFile(new URL('../../../../data/recommendation-policy.json', import.meta.url), 'utf8'));
    expect(isRecommendationPolicyFile(policy)).toBe(true);
    expect(SAFE_RECOMMENDATION_POLICY.recommendationArchitecture).toBe(LIVE_RECOMMENDATION_ARCHITECTURE);
  });

  it('rejects the stale historical architecture even when all runtime fields are present', () => {
    expect(isRecommendationPolicyFile({ ...SAFE_RECOMMENDATION_POLICY, recommendationArchitecture: 'pick-ev-v1' })).toBe(false);
  });

  it('cannot load historical evaluation evidence as runtime configuration', async () => {
    const evidence: unknown = JSON.parse(await readFile(new URL('../../../../data/recommendation-evaluation.json', import.meta.url), 'utf8'));
    expect(isRecommendationPolicyFile(evidence)).toBe(false);
  });
});
