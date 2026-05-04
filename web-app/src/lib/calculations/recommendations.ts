/**
 * Recommendation engine
 *
 * Generates player recommendations based on ECR rankings,
 * team needs, and positional scarcity.
 */

import type {
  Player,
  PositionNeed,
  Recommendation,
} from '@fantasy-draft/shared';

/**
 * Result of the recommendation engine
 */
export interface RecommendationResult {
  /** Best available players by pure ECR ranking */
  readonly bestAvailable: readonly Recommendation[];
  /** Players recommended based on team needs and scarcity */
  readonly byNeed: readonly Recommendation[];
}

/**
 * Generate player recommendations
 *
 * Two recommendation lists:
 * 1. Best Available: Pure ECR ranking (best players regardless of need)
 * 2. By Need: Factors in team needs, scarcity, and TE premium
 *
 * @param availablePlayers - Players not yet drafted
 * @param teamNeeds - Current team positional needs
 * @param limit - Maximum recommendations per list (default: 10)
 * @returns Object with bestAvailable and byNeed recommendation arrays
 *
 * @example
 * const { bestAvailable, byNeed } = getRecommendations(available, needs, 5);
 */
export function getRecommendations(
  availablePlayers: readonly Player[],
  teamNeeds: readonly PositionNeed[],
  limit: number = 10
): RecommendationResult {
  // Best Available: Pure ECR ranking
  const sortedByEcr = [...availablePlayers].sort((a, b) => a.ecrRank - b.ecrRank);

  const bestAvailable: Recommendation[] = sortedByEcr
    .slice(0, limit)
    .map((player) => ({
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      reason: `ECR #${player.ecrRank}`,
      score: 100 - player.ecrRank,
    }));

  // By Need: Factor in team needs and scarcity
  const criticalPositions = teamNeeds
    .filter((n) => n.priority === 'critical' || n.priority === 'high')
    .map((n) => n.position);

  // If no critical/high needs, fall back to medium priority
  const targetPositions = criticalPositions.length > 0
    ? criticalPositions
    : teamNeeds
        .filter((n) => n.priority === 'medium')
        .map((n) => n.position);

  const byNeed: Recommendation[] = availablePlayers
    .filter((p) => targetPositions.includes(p.position))
    .map((player) => {
      const need = teamNeeds.find((n) => n.position === player.position);

      if (!need) {
        return null;
      }

      // Calculate score multipliers
      const needMultiplier = need.priority === 'critical' ? 2 : 1.5;
      const scarcityMultiplier = 1 + need.scarcityScore / 20;

      // TE Premium boost for this league (+0.5 PPR for TEs)
      const tePremiumBoost = player.position === 'TE' ? 1.15 : 1;

      // Base score from ECR, then apply multipliers
      const baseScore = 100 - player.ecrRank;
      const score = baseScore * needMultiplier * scarcityMultiplier * tePremiumBoost;

      return {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        reason: `${need.priority} need, scarcity ${need.scarcityScore.toFixed(1)}`,
        score,
      };
    })
    .filter((r): r is Recommendation => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { bestAvailable, byNeed };
}

/**
 * Get a single top recommendation based on team needs
 *
 * @param availablePlayers - Players not yet drafted
 * @param teamNeeds - Current team positional needs
 * @returns The top recommended player or null if none available
 */
export function getTopRecommendation(
  availablePlayers: readonly Player[],
  teamNeeds: readonly PositionNeed[]
): Recommendation | null {
  const { byNeed, bestAvailable } = getRecommendations(availablePlayers, teamNeeds, 1);

  // Prefer need-based recommendation, fall back to best available
  return byNeed[0] ?? bestAvailable[0] ?? null;
}
