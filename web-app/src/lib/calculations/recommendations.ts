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

type RecommendationDiagnostics = NonNullable<Recommendation['diagnostics']>;
type RecommendationSubScores = NonNullable<Recommendation['subScores']>;

/**
 * Result of the recommendation engine
 */
export interface RecommendationResult {
  /** Best available players by pure ECR ranking */
  readonly bestAvailable: readonly Recommendation[];
  /** Players recommended based on team needs and scarcity */
  readonly byNeed: readonly Recommendation[];
}

function getDiagnostics(player: Player): RecommendationDiagnostics {
  return {
    expertRank: player.ecrRank,
    marketRank: player.marketRank,
    marketDelta: player.valueScore,
    projectedPoints: player.projectedPoints,
    tier: player.tier,
  };
}

function getBaseSubScores(player: Player): RecommendationSubScores {
  return {
    expertRankScore: Math.max(0, 120 - player.ecrRank),
    marketValueScore: player.valueScore * 0.75,
    projectionScore: player.projectedPoints * 0.14,
    replacementScore: player.valueOverReplacement * 3.25,
    upsideScore: player.upsideScore * 1.8,
    tierUrgencyScore: player.tierDropoffScore * 8,
    survivalScore: (1 - player.nextPickSurvivalProbability) * 18,
    riskPenalty: player.injuryRiskScore,
  };
}

function sumBaseSubScores(subScores: RecommendationSubScores): number {
  return (
    subScores.expertRankScore +
    subScores.marketValueScore +
    subScores.projectionScore +
    subScores.replacementScore +
    subScores.upsideScore +
    subScores.tierUrgencyScore +
    subScores.survivalScore -
    subScores.riskPenalty
  );
}

function formatMarketDelta(valueScore: number): string {
  if (valueScore > 0) {
    return `Steal +${valueScore}`;
  }
  if (valueScore < 0) {
    return `Reach ${valueScore}`;
  }
  return 'Market even';
}

function buildBestAvailableRecommendation(player: Player): Recommendation {
  const subScores = getBaseSubScores(player);
  const diagnostics = getDiagnostics(player);

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: `FP #${player.ecrRank}, Sleeper #${player.marketRank}, ${formatMarketDelta(player.valueScore)}`,
    score: sumBaseSubScores(subScores),
    diagnostics,
    subScores,
  };
}

function buildNeedRecommendation(player: Player, need: PositionNeed): Recommendation {
  const baseSubScores = getBaseSubScores(player);
  const needMultiplier = need.priority === 'critical' ? 2 : 1.5;
  const scarcityMultiplier = 1 + need.scarcityScore / 20;
  const tePremiumBoost = player.position === 'TE' ? 1.15 : 1;

  const subScores: RecommendationSubScores = {
    ...baseSubScores,
    needMultiplier,
    scarcityMultiplier,
    tePremiumBoost,
  };

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: `${need.priority} need · FP #${player.ecrRank} vs Sleeper #${player.marketRank} · ${formatMarketDelta(player.valueScore)}`,
    score: sumBaseSubScores(baseSubScores) * needMultiplier * scarcityMultiplier * tePremiumBoost,
    diagnostics: getDiagnostics(player),
    subScores,
  };
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
  const bestAvailable = [...availablePlayers]
    .map(buildBestAvailableRecommendation)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

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

      return buildNeedRecommendation(player, need);
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
