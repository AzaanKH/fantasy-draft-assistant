import type { Recommendation } from '@fantasy-draft/shared';
import type { DraftDecisionView } from '@/features/recommendations/draft-decision';

/**
 * Read a position-scoped list that has already been ranked by the canonical
 * league-aware recommendation engine. Position filters must never rebuild or
 * re-sort recommendations from player ECR fields in the UI.
 */
export function getPositionRecommendations(
  decision: DraftDecisionView,
  limit: number = 12
): readonly Recommendation[] {
  return decision.recommendations.length <= limit
    ? decision.recommendations
    : decision.recommendations.slice(0, limit);
}
