
import { RANKING_LABELS } from '@/lib/demo-mode';
import { LIVE_RECOMMENDATION_ARCHITECTURE } from '@fantasy-draft/shared';
import type { RecommendationPolicyFile } from './types';

export const SAFE_RECOMMENDATION_POLICY: RecommendationPolicyFile = {
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
  reason: `Recommendation policy unavailable; using the safe ${RANKING_LABELS.inline} fallback.`,
};

