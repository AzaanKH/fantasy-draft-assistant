
import type { RecommendationPolicyFile } from './types';

export const SAFE_RECOMMENDATION_POLICY: RecommendationPolicyFile = {
  generatedAt: '1970-01-01T00:00:00.000Z',
  modelVersion: 'safe-ecr-fallback',
  modelPredictionsEnabled: false,
  contractSignalEnabled: false,
  pickEvOverrideEnabled: false,
  pickEvOverrideThreshold: 0,
  fallback: 'fantasypros-ecr-market',
  shadowLogging: {
    enabled: false,
    season: 2026,
    endpoint: '/api/shadow-recommendations',
  },
  reason: 'Recommendation policy unavailable; using the safe ECR fallback.',
};

