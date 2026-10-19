import { LIVE_DRAFT_DISPLAY, type DraftDisplayContext } from '../../draft/display-context.js';
import { LIVE_RECOMMENDATION_ARCHITECTURE } from '../../recommendation-policy.js';
import type { RecommendationPolicyFile } from './types.js';

export function createSafeRecommendationPolicy(display: DraftDisplayContext = LIVE_DRAFT_DISPLAY): RecommendationPolicyFile {
  return {
    generatedAt: '1970-01-01T00:00:00.000Z',
    recommendationArchitecture: LIVE_RECOMMENDATION_ARCHITECTURE,
    modelPredictionsEnabled: false,
    contractSignalEnabled: false,
    fallback: 'fantasypros-ecr-market',
    shadowLogging: {
      enabled: false,
      season: 2026,
      endpoint: '/api/shadow-recommendations',
    },
    reason: `Recommendation policy unavailable; using the safe ${display.RANKING_LABELS.inline} fallback.`,
  };
}

export const SAFE_RECOMMENDATION_POLICY = createSafeRecommendationPolicy();
