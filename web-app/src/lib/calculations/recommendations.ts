/**
 * Recommendation engine
 *
 * Generates player recommendations based on ECR rankings,
 * team needs, and positional scarcity.
 */

import type {
  NeedPriority,
  Player,
  PositionNeed,
  Recommendation,
} from '@fantasy-draft/shared';
import { calculateAllScarcityScores } from './scarcity';

type RecommendationDiagnostics = NonNullable<Recommendation['diagnostics']>;
type RecommendationSubScores = NonNullable<Recommendation['subScores']>;

export interface RecommendationContext {
  readonly currentPick?: number;
  readonly totalPicks?: number;
  readonly isMyTurn?: boolean;
}

/**
 * Result of the recommendation engine
 */
export interface RecommendationResult {
  /** Roster-aware answer to "Who should I draft right now?" */
  readonly draftNow: readonly Recommendation[];
  /** Best available players by pure ECR ranking */
  readonly bestAvailable: readonly Recommendation[];
  /** Players recommended based on team needs and scarcity */
  readonly byNeed: readonly Recommendation[];
}

const NEED_SCORES: Record<NeedPriority, number> = {
  critical: 34,
  high: 24,
  medium: 14,
  low: 4,
  filled: -18,
};

const PROJECTION_BASELINES: Record<Player['position'], number> = {
  QB: 295,
  RB: 245,
  WR: 240,
  TE: 205,
  K: 130,
  DEF: 130,
};
const SPECIAL_TEAMS_MAX_VOR = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number = 1): number {
  return Number(value.toFixed(digits));
}

function getDraftProgress(context: RecommendationContext | undefined): number {
  if (!context?.currentPick || !context.totalPicks || context.totalPicks <= 0) {
    return 0;
  }
  return clamp((context.currentPick - 1) / context.totalPicks, 0, 1);
}

function getDiagnostics(player: Player): RecommendationDiagnostics {
  return {
    expertRank: player.ecrRank,
    marketRank: player.marketRank,
    marketDelta: player.valueScore,
    projectedPoints: player.projectedPoints,
    valueOverReplacement: player.valueOverReplacement,
    tier: player.tier,
    nextPickSurvivalProbability: player.nextPickSurvivalProbability,
    leagueAdjustedMarketRank: player.leagueAdjustedMarketRank,
    leagueMarketDelta: player.leagueMarketDelta,
    leaguePositionTendency: player.leaguePositionTendency,
  };
}

function getBaseSubScores(player: Player): RecommendationSubScores {
  const predictionSourceBoost = player.predictionSource === 'model'
    ? 5
    : player.predictionSource === 'fantasypros'
      ? 2
      : 0;
  const replacementValue = player.position === 'K' || player.position === 'DEF'
    ? Math.min(player.valueOverReplacement, SPECIAL_TEAMS_MAX_VOR)
    : player.valueOverReplacement;

  return {
    expertRankScore: Math.max(0, 120 - player.ecrRank),
    marketValueScore: player.valueScore * 0.75,
    projectionScore: Math.max(0, (player.projectedPoints - PROJECTION_BASELINES[player.position]) * 0.18) + predictionSourceBoost,
    replacementScore: replacementValue * 3.75,
    upsideScore: player.upsideScore * 1.8,
    tierUrgencyScore: player.tierDropoffScore * 8,
    survivalScore: (1 - player.nextPickSurvivalProbability) * 18,
    riskPenalty: player.injuryRiskScore,
    uncertaintyPenalty: round(player.uncertaintyScore * 0.35),
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
    subScores.survivalScore +
    (subScores.rosterNeedScore ?? 0) +
    (subScores.scarcityScore ?? 0) +
    (subScores.draftStateScore ?? 0) -
    subScores.riskPenalty -
    subScores.uncertaintyPenalty
  );
}

function formatMarketDelta(valueScore: number): string {
  if (valueScore > 0) {
    return `Steal +${String(valueScore)}`;
  }
  if (valueScore < 0) {
    return `Reach ${String(valueScore)}`;
  }
  return 'Market even';
}

function getDraftStateScore(player: Player, context: RecommendationContext | undefined): number {
  const draftProgress = getDraftProgress(context);
  const isLateDraft = draftProgress >= 0.72;
  const earlyKickerDefensePenalty = player.position === 'K' || player.position === 'DEF'
    ? isLateDraft
      ? 0
      : -140 * (1 - draftProgress)
    : 0;
  const turnUrgencyBoost = context?.isMyTurn
    ? (1 - player.nextPickSurvivalProbability) * 4
    : 0;
  const lateKickerDefenseBoost = isLateDraft && (player.position === 'K' || player.position === 'DEF')
    ? 8
    : 0;

  return round(earlyKickerDefensePenalty + turnUrgencyBoost + lateKickerDefenseBoost);
}

function getNeedReason(need: PositionNeed | undefined): string {
  if (!need) {
    return 'roster context unavailable';
  }
  if (need.priority === 'filled') {
    return 'roster slot filled';
  }
  if (need.priority === 'low') {
    return 'depth fit';
  }
  return `${need.priority} roster need`;
}

function buildDraftNowRecommendation(
  player: Player,
  need: PositionNeed | undefined,
  poolScarcityScore: number,
  context: RecommendationContext | undefined
): Recommendation {
  const rosterNeedScore = NEED_SCORES[need?.priority ?? 'low'];
  const scarcityScore = poolScarcityScore * 2.1 + player.tierDropoffScore * 5;
  const draftStateScore = getDraftStateScore(player, context);
  const subScores: RecommendationSubScores = {
    ...getBaseSubScores(player),
    rosterNeedScore,
    scarcityScore: round(scarcityScore),
    draftStateScore,
  };
  const survivalPercent = Math.round(player.nextPickSurvivalProbability * 100);
  const survivalText = player.nextPickSurvivalProbability <= 0.35
    ? 'unlikely to survive'
    : `${String(survivalPercent)}% to next pick`;

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: [
      getNeedReason(need),
      `VOR ${player.valueOverReplacement.toFixed(1)}`,
      formatMarketDelta(player.valueScore),
      survivalText,
    ].join(' · '),
    score: round(sumBaseSubScores(subScores)),
    diagnostics: getDiagnostics(player),
    subScores,
  };
}

function buildBestAvailableRecommendation(player: Player): Recommendation {
  const subScores = getBaseSubScores(player);
  const diagnostics = getDiagnostics(player);
  const survivalPercent = Math.round(player.nextPickSurvivalProbability * 100);
  const leagueContext = player.leaguePositionTendency
    ? `, ${String(survivalPercent)}% to next pick`
    : '';

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: `FP #${String(player.ecrRank)}, Sleeper #${String(player.marketRank)}, ${formatMarketDelta(player.valueScore)}${leagueContext}`,
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
    reason: [
      `${need.priority} need`,
      `FP #${String(player.ecrRank)} vs Sleeper #${String(player.marketRank)}`,
      formatMarketDelta(player.valueScore),
      `${String(Math.round(player.nextPickSurvivalProbability * 100))}% to next pick`,
    ].join(' · '),
    score: sumBaseSubScores(baseSubScores) * needMultiplier * scarcityMultiplier * tePremiumBoost,
    diagnostics: getDiagnostics(player),
    subScores,
  };
}

/**
 * Generate player recommendations
 *
 * Three recommendation lists:
 * 1. Draft Now: Combined roster-aware ranking for the current pick
 * 2. Best Available: Pure player/market value regardless of need
 * 3. By Need: Position-filtered view for urgent roster gaps
 *
 * @param availablePlayers - Players not yet drafted
 * @param teamNeeds - Current team positional needs
 * @param limit - Maximum recommendations per list (default: 10)
 * @returns Object with draftNow, bestAvailable, and byNeed recommendation arrays
 *
 * @example
 * const { bestAvailable, byNeed } = getRecommendations(available, needs, 5);
 */
export function getRecommendations(
  availablePlayers: readonly Player[],
  teamNeeds: readonly PositionNeed[],
  limit: number = 10,
  context?: RecommendationContext
): RecommendationResult {
  const needsByPosition = new Map(teamNeeds.map((need) => [need.position, need]));
  const scarcityScores = calculateAllScarcityScores(availablePlayers);

  const draftNow = [...availablePlayers]
    .map((player) =>
      buildDraftNowRecommendation(
        player,
        needsByPosition.get(player.position),
        scarcityScores.get(player.position) ?? 5,
        context
      )
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

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

  return { draftNow, bestAvailable, byNeed };
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
  teamNeeds: readonly PositionNeed[],
  context?: RecommendationContext
): Recommendation | null {
  const { draftNow, byNeed, bestAvailable } = getRecommendations(
    availablePlayers,
    teamNeeds,
    1,
    context
  );

  return draftNow[0] ?? byNeed[0] ?? bestAvailable[0] ?? null;
}
