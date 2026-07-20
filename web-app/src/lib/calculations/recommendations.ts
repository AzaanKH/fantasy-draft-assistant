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
import {
  getDraftProgress,
  isSpecialTeamsPosition,
  shouldDeferSpecialTeams,
  SPECIAL_TEAMS_LATE_DRAFT_PROGRESS,
} from './draft-stage';

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
  /** Best available players by composite player-quality score */
  readonly bestAvailable: readonly Recommendation[];
  /** Draftable contributors with a meaningful Sleeper market discount */
  readonly marketValues: readonly Recommendation[];
  /** Discounted replacement-level players hidden from Best Value by default */
  readonly marketStashes: readonly Recommendation[];
  /** Players recommended based on team needs and scarcity */
  readonly byNeed: readonly Recommendation[];
}

const NEED_SCORES: Record<NeedPriority, number> = {
  critical: 34,
  high: 24,
  medium: 14,
  low: 4,
  defer: -24,
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
const MIN_ACTIONABLE_MARKET_DISCOUNT = 5;
const MIN_ACTIONABLE_MARKET_VOR = 1;

function round(value: number, digits: number = 1): number {
  return Number(value.toFixed(digits));
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function getGuardedValueOverReplacement(player: Player): number {
  return player.position === 'K' || player.position === 'DEF'
    ? Math.min(player.valueOverReplacement, SPECIAL_TEAMS_MAX_VOR)
    : player.valueOverReplacement;
}

function getRosterAdjustedValueOverReplacement(
  player: Player,
  need: PositionNeed | undefined,
  context: RecommendationContext | undefined
): number {
  const replacementValue = getGuardedValueOverReplacement(player);
  if (!need || need.priority !== 'low') {
    return replacementValue;
  }

  const draftProgress = getDraftProgress(context);
  // Positional VOR overstates the FLEX or bench utility of a second QB or TE.
  if (player.position === 'QB') {
    return replacementValue * interpolate(0.2, 0.65, draftProgress);
  }
  if (player.position === 'TE') {
    return replacementValue * interpolate(0.45, 0.8, draftProgress);
  }

  return replacementValue;
}

function isSpecialTeams(player: Player): boolean {
  return isSpecialTeamsPosition(player.position);
}

function getDiagnostics(player: Player): RecommendationDiagnostics {
  return {
    expertRank: player.ecrRank,
    marketRank: player.marketRank,
    marketDelta: player.valueScore,
    projectedPoints: player.projectedPoints,
    valueOverReplacement: getGuardedValueOverReplacement(player),
    tier: player.tier,
    nextPickSurvivalProbability: player.nextPickSurvivalProbability,
    leagueAdjustedMarketRank: player.leagueAdjustedMarketRank,
    leagueMarketDelta: player.leagueMarketDelta,
    leaguePositionTendency: player.leaguePositionTendency,
  };
}

function getBaseSubScores(
  player: Player,
  replacementValue: number = getGuardedValueOverReplacement(player)
): RecommendationSubScores {
  const predictionSourceBoost = player.predictionSource === 'model'
    ? 5
    : player.predictionSource === 'fantasypros'
      ? 2
      : 0;

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
  const isLateDraft = draftProgress >= SPECIAL_TEAMS_LATE_DRAFT_PROGRESS;
  const earlyKickerDefensePenalty = isSpecialTeams(player)
    ? isLateDraft
      ? 0
      : -140 * (1 - draftProgress)
    : 0;
  const turnUrgencyBoost = context?.isMyTurn
    ? (1 - player.nextPickSurvivalProbability) * 4
    : 0;
  const lateKickerDefenseBoost = isLateDraft && isSpecialTeams(player)
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
  if (need.priority === 'defer') {
    return 'defer until late rounds';
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
  const replacementValue = getRosterAdjustedValueOverReplacement(player, need, context);
  const scarcityScore = poolScarcityScore * 2.1 + player.tierDropoffScore * 5;
  const draftStateScore = getDraftStateScore(player, context);
  const subScores: RecommendationSubScores = {
    ...getBaseSubScores(player, replacementValue),
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
      `VOR ${getGuardedValueOverReplacement(player).toFixed(1)}`,
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
    reason: `FP #${String(player.ecrRank)}, ADP #${String(player.marketRank)}, ${formatMarketDelta(player.valueScore)}${leagueContext}`,
    score: sumBaseSubScores(subScores),
    diagnostics,
    subScores,
  };
}

function buildMarketValueRecommendation(player: Player, isLateRoundStash: boolean = false): Recommendation {
  const subScores = getBaseSubScores(player);
  const diagnostics = getDiagnostics(player);

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: [
      ...(isLateRoundStash ? ['Late-round stash'] : []),
      formatMarketDelta(player.valueScore),
      `FP #${String(player.ecrRank)} vs ADP #${String(player.marketRank)}`,
      `${String(Math.round(player.nextPickSurvivalProbability * 100))}% to next pick`,
    ].join(' · '),
    score: player.valueScore,
    diagnostics,
    subScores,
  };
}

function hasMaterialMarketDiscount(player: Player): boolean {
  return player.valueScore >= MIN_ACTIONABLE_MARKET_DISCOUNT;
}

function isActionableMarketValue(player: Player): boolean {
  return (
    hasMaterialMarketDiscount(player) &&
    getGuardedValueOverReplacement(player) >= MIN_ACTIONABLE_MARKET_VOR
  );
}

function isLateRoundStash(player: Player): boolean {
  return (
    hasMaterialMarketDiscount(player) &&
    getGuardedValueOverReplacement(player) < MIN_ACTIONABLE_MARKET_VOR
  );
}

function sortByMarketDiscount(a: Recommendation, b: Recommendation): number {
  return (
    b.score - a.score ||
    (a.diagnostics?.expertRank ?? Number.MAX_SAFE_INTEGER) -
      (b.diagnostics?.expertRank ?? Number.MAX_SAFE_INTEGER)
  );
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
      `FP #${String(player.ecrRank)} vs ADP #${String(player.marketRank)}`,
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
 * Five recommendation lists:
 * 1. Draft Now: Combined roster-aware ranking for the current pick
 * 2. Best Available: Composite player quality regardless of need
 * 3. Best Value: Actionable Sleeper market discounts above replacement level
 * 4. By Need: Position-filtered view for urgent roster gaps
 * 5. Market Stashes: Discounted replacement-level players hidden from Best Value by default
 *
 * @param availablePlayers - Players not yet drafted
 * @param teamNeeds - Current team positional needs
 * @param limit - Maximum recommendations per list (default: 10)
 * @returns Object with draftNow, bestAvailable, marketValues, marketStashes, and byNeed recommendation arrays
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
  const hasOffensivePlayers = availablePlayers.some((player) => !isSpecialTeams(player));
  const recommendationPool = shouldDeferSpecialTeams(context) && hasOffensivePlayers
    ? availablePlayers.filter((player) => !isSpecialTeams(player))
    : availablePlayers;

  const draftNow = [...recommendationPool]
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

  const bestAvailable = [...recommendationPool]
    .map(buildBestAvailableRecommendation)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const marketValues = [...recommendationPool]
    .filter(isActionableMarketValue)
    .map((player) => buildMarketValueRecommendation(player))
    .sort(sortByMarketDiscount)
    .slice(0, limit);

  const marketStashes = [...recommendationPool]
    .filter(isLateRoundStash)
    .map((player) => buildMarketValueRecommendation(player, true))
    .sort(sortByMarketDiscount)
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

  const byNeed: Recommendation[] = recommendationPool
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

  return { draftNow, bestAvailable, marketValues, marketStashes, byNeed };
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
