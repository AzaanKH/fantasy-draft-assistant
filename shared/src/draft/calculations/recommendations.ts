/**
 * Recommendation engine
 *
 * Generates player recommendations based on ECR rankings,
 * team needs, and positional scarcity.
 */

import { asVor, type Vor } from '../../units/brands.js';
import { LIVE_DRAFT_DISPLAY, type DraftDisplayContext } from '../display-context.js';
import { POSITIONS, type Position, type Player } from '../../player.js';
import type { NeedPriority, PositionNeed, Recommendation, RosterRequirements } from '../../draft.js';
import type { LineupPlayer } from '../../lineup-utility.js';
import { calculateAllScarcityScores } from './scarcity.js';
import {
  calculateTierAvailability,
  getTierKey,
  type TierAvailability,
} from './tiers.js';
import {
  isSpecialTeamsPosition,
  shouldDeferSpecialTeams,
} from './draft-stage.js';
import {
  BEST_PICK_ECR_NEIGHBORHOOD,
  evaluateBestPickPolicy,
  prepareDraftTimingAlternatives,
  type BestPickPolicyEvaluation,
  type DraftTimingAlternatives,
} from './best-pick-policy.js';

type RecommendationDiagnostics = NonNullable<Recommendation['diagnostics']>;
type RecommendationSubScores = NonNullable<Recommendation['subScores']>;

export interface RecommendationContext {
  readonly currentPick?: number;
  readonly totalPicks?: number;
  readonly isMyTurn?: boolean;
  readonly totalTeams?: number;
  readonly requirements?: RosterRequirements;
  readonly rosterPlayers?: readonly LineupPlayer[];
  readonly rosterCounts?: Readonly<Partial<Record<Position, number>>>;
  /** Manager selections left, including the current selection. */
  readonly selectionsRemaining?: number;
}

/**
 * Result of the recommendation engine
 */
export interface RecommendationResult {
  /** Roster-aware answer to "Who should I draft right now?" */
  readonly draftNow: readonly Recommendation[];
  /** Best legal RB choices, with an explicit price for intentionally drafting ahead of market. */
  readonly rbIntentionalReaches: readonly Recommendation[];
  /** Best Player ordering: the available-player ECR anchor, with no policy adjustments. */
  readonly bestAvailable: readonly Recommendation[];
  /** Draftable contributors with a meaningful Sleeper market discount */
  readonly marketValues: readonly Recommendation[];
  /** Discounted replacement-level players hidden from Best Value by default */
  readonly marketStashes: readonly Recommendation[];
  /** Players recommended based on team needs and scarcity */
  readonly byNeed: readonly Recommendation[];
  /** Canonical policy decision that ordered the Draft Now list. */
  readonly selection: RecommendationSelection;
}

export interface RecommendationBoardResult {
  readonly overall: RecommendationResult;
  readonly byPosition: Readonly<Record<Position, RecommendationResult>>;
}

type RecommendationSelectionPolicy =
  | 'ecr-anchor'
  | 'league-aware-score'
  | 'primary-league-policy'
  | 'roster-feasibility';

export interface RecommendationSelection {
  readonly preferredPlayerId?: string;
  readonly policy: RecommendationSelectionPolicy;
  readonly ecrNeighborhood?: number;
  readonly feasibilityException?: boolean;
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

function getGuardedValueOverReplacement(player: Player): Vor {
  return player.position === 'K' || player.position === 'DEF'
    ? asVor(Math.min(player.valueOverReplacement, SPECIAL_TEAMS_MAX_VOR))
    : player.valueOverReplacement;
}

function isSpecialTeams(player: Player): boolean {
  return isSpecialTeamsPosition(player.position);
}

function getDiagnostics(
  player: Player,
  tierAvailability?: TierAvailability
): RecommendationDiagnostics {
  return {
    expertRank: player.ecrRank,
    marketRank: player.marketRank,
    marketDelta: player.valueScore,
    projectedPoints: player.projectedPoints,
    valueOverReplacement: getGuardedValueOverReplacement(player),
    tier: player.tier,
    fantasyProsTier: player.fantasyProsTier,
    tierSource: player.tierSource,
    tierDropoffPoints:
      tierAvailability?.dropoffPoints ?? player.tierDropoffPoints,
    tierRemaining: tierAvailability?.remaining,
    isLastInTier:
      tierAvailability !== undefined &&
      tierAvailability.remaining === 1 &&
      tierAvailability.nextTier !== undefined &&
      tierAvailability.isMeaningfulCliff,
    nextPickSurvivalProbability:
      player.nextPickNumber === undefined && player.survivalModelSource !== undefined
        ? undefined
        : player.nextPickSurvivalProbability,
    nextPickNumber: player.nextPickNumber,
    nextPickLabel: player.nextPickLabel,
    picksUntilNextPick: player.picksUntilNextPick,
    survivalModelSource: player.survivalModelSource,
    historicalExpectedPick: player.historicalExpectedPick,
    consensusMarketPick: player.consensusMarketPick,
    sleeperTimingPick: player.sleeperTimingPick,
    survivalModelSampleSize: player.survivalModelSampleSize,
    leagueAdjustedMarketRank: player.leagueAdjustedMarketRank,
    leagueMarketDelta: player.leagueMarketDelta,
    leaguePositionTendency: player.leaguePositionTendency,
  };
}

function getTierReason(
  player: Player,
  tierAvailability: TierAvailability | undefined
): string {
  if (!tierAvailability) return `${player.position} T${String(player.tier)}`;
  if (
    tierAvailability.remaining === 1 &&
    tierAvailability.nextTier !== undefined &&
    tierAvailability.isMeaningfulCliff
  ) {
    return `last ${player.position} T${String(player.tier)}, ${tierAvailability.dropoffPoints.toFixed(1)} point cliff`;
  }
  return `${String(tierAvailability.remaining)} left in ${player.position} T${String(player.tier)}`;
}

function getBaseSubScores(player: Player): RecommendationSubScores {
  const predictionSourceBoost = player.predictionSource === 'model'
    ? 5
    : player.predictionSource === 'fantasypros'
      ? 2
      : 0;

  return {
    expertRankScore: Math.max(0, 120 - player.ecrRank),
    marketValueScore: player.valueScore * 0.75,
    projectionScore: Math.max(0, (player.projectedPoints - PROJECTION_BASELINES[player.position]) * 0.18) + predictionSourceBoost,
    replacementScore: getGuardedValueOverReplacement(player) * 3.75,
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

function getMarketReachCost(
  player: Player,
  context: RecommendationContext | undefined
): number {
  const marketPrice = player.leagueAdjustedMarketRank ?? player.marketRank;
  if (context?.currentPick !== undefined) {
    return round(Math.max(0, marketPrice - context.currentPick));
  }
  return round(Math.max(0, -player.valueScore));
}

function buildRbIntentionalReachRecommendation(
  player: Player,
  need: PositionNeed | undefined,
  poolScarcityScore: number,
  context: RecommendationContext | undefined,
  tierAvailability: TierAvailability | undefined
): Recommendation {
  const subScores: RecommendationSubScores = {
    ...getBaseSubScores(player),
    rosterNeedScore: NEED_SCORES[need?.priority ?? 'low'],
    scarcityScore: round(poolScarcityScore * 2.1 + player.tierDropoffScore * 5),
    draftStateScore: round(context?.isMyTurn
      ? (1 - player.nextPickSurvivalProbability) * 4
      : 0),
  };
  const marketReachCost = getMarketReachCost(player, context);
  const survivalPercent = Math.round(player.nextPickSurvivalProbability * 100);
  const label = marketReachCost > 0
    ? 'Over market price, but correct for roster/scarcity'
    : 'At market price and correct for roster/scarcity';

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    score: round(sumBaseSubScores(subScores)),
    subScores,
    reason: [
      label,
      `custom VOR ${getGuardedValueOverReplacement(player).toFixed(1)}`,
      getTierReason(player, tierAvailability),
      `${String(survivalPercent)}% to next pick`,
      `market reach cost ${marketReachCost.toFixed(1)} picks`,
    ].join(' · '),
    diagnostics: {
      ...getDiagnostics(player, tierAvailability),
      marketReachCost,
    },
  };
}

function buildBestPickPolicyRecommendation(
  evaluation: BestPickPolicyEvaluation,
  tierAvailability: TierAvailability | undefined,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): Recommendation {
  const { RANKING_LABELS } = display;
  const { player, factors } = evaluation;
  const feasibilityLabel = factors.conservativeBoundary.feasibilityException
    ? 'Legal-roster requirement'
    : factors.conservativeBoundary.withinBoundary
      ? `Conservative ${RANKING_LABELS.inline} adjustment`
      : `Outside normal ${RANKING_LABELS.inline} window`;

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: [
      feasibilityLabel,
      `${RANKING_LABELS.short} #${String(player.ecrRank)}`,
      `league value +${factors.leagueValue.score.toFixed(1)}/${factors.leagueValue.maxScore.toFixed(0)}`,
      `roster fit +${factors.rosterFit.score.toFixed(1)}/${factors.rosterFit.maxScore.toFixed(0)}`,
      ...(factors.depthValue.score > 0
        ? [
            `depth value +${factors.depthValue.score.toFixed(1)}/${factors.depthValue.maxScore.toFixed(0)}`,
          ]
        : []),
      ...(factors.tierSupply.score > 0
        ? [
            `tier wait cost +${factors.tierSupply.costOfWaiting.toFixed(1)}/${factors.tierSupply.maxScore.toFixed(0)}`,
          ]
        : []),
      ...(factors.draftTiming.score > 0
        ? [
            `next-pick wait cost +${factors.draftTiming.score.toFixed(1)}/${factors.draftTiming.maxScore.toFixed(0)}`,
          ]
        : []),
    ].join(' · '),
    score: evaluation.score,
    diagnostics: {
      ...getDiagnostics(player, tierAvailability),
      costOfWaiting: factors.tierSupply.costOfWaiting,
      replacementPoints: factors.leagueValue.replacementPoints,
      expectedNextPickAlternativeValue:
        factors.draftTiming.expectedAlternative?.expectedValue,
      expectedNextPickAlternative: factors.draftTiming.expectedAlternative,
      nextPickCostOfWaiting: factors.draftTiming.costOfWaiting,
    },
    decisionFactors: factors,
  };
}

function buildBestAvailableRecommendation(
  player: Player,
  tierAvailability: TierAvailability | undefined,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): Recommendation {
  const { RANKING_LABELS, IS_DEMO } = display;
  const diagnostics = getDiagnostics(player, tierAvailability);

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: IS_DEMO
      ? `${RANKING_LABELS.anchor} #${String(player.ecrRank)} among available players`
      : `Trusted ECR Anchor #${String(player.ecrRank)} among available players`,
    // This score is intentionally ECR-only. Diagnostics remain available for
    // comparison, but roster, timing, market, and model signals cannot reorder it.
    score: -Number(player.ecrRank),
    diagnostics,
  };
}

function buildMarketValueRecommendation(
  player: Player,
  tierAvailability: TierAvailability | undefined,
  isLateRoundStash: boolean = false
): Recommendation {
  const subScores = getBaseSubScores(player);
  const diagnostics = getDiagnostics(player, tierAvailability);

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

function buildNeedRecommendation(
  player: Player,
  need: PositionNeed,
  tierAvailability: TierAvailability | undefined
): Recommendation {
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
    diagnostics: getDiagnostics(player, tierAvailability),
    subScores,
  };
}

/**
 * Generate player recommendations
 *
 * Six recommendation lists:
 * 1. Draft Now: Combined roster-aware ranking for the current pick
 * 2. Best RB / Intentional Reach: RB-only roster/scarcity choice with explicit market cost
 * 3. Best Player: Trusted ECR order regardless of roster need or draft timing
 * 4. Best Value: Actionable Sleeper market discounts above replacement level
 * 5. By Need: Position-filtered view for urgent roster gaps
 * 6. Market Stashes: Discounted replacement-level players hidden from Best Value by default
 *
 * @param availablePlayers - Players not yet drafted
 * @param teamNeeds - Current team positional needs
 * @param limit - Maximum recommendations per list (default: 10)
 * @returns Object with all recommendation arrays
 *
 * @example
 * const { bestAvailable, byNeed } = getRecommendations(available, needs, 5);
 */
export function getRecommendations(
  availablePlayers: readonly Player[],
  teamNeeds: readonly PositionNeed[],
  limit: number = 10,
  context?: RecommendationContext,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): RecommendationResult {
  return calculateRecommendations(availablePlayers, teamNeeds, limit, context, undefined, undefined, display);
}

function getLegalPlayers(
  availablePlayers: readonly Player[],
  context?: RecommendationContext
): readonly Player[] {
  const requirements = context?.requirements;
  return requirements
    ? availablePlayers.filter((player) =>
        (context.rosterCounts?.[player.position] ?? 0) <
          requirements[player.position].max
      )
    : availablePlayers;
}

/** Build the overall and position decisions with one legal pool and timing index. */
export function getRecommendationBoard(
  availablePlayers: readonly Player[],
  teamNeeds: readonly PositionNeed[],
  limit: number = 10,
  context?: RecommendationContext,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): RecommendationBoardResult {
  const legalPlayers = getLegalPlayers(availablePlayers, context);
  const draftTimingAlternatives = prepareDraftTimingAlternatives(legalPlayers);
  const playersByPosition = {} as Record<Position, Player[]>;
  const legalByPosition = {} as Record<Position, Player[]>;
  for (const position of POSITIONS) {
    playersByPosition[position] = [];
    legalByPosition[position] = [];
  }
  for (const player of availablePlayers) {
    playersByPosition[player.position].push(player);
  }
  for (const player of legalPlayers) {
    legalByPosition[player.position].push(player);
  }
  const overall = calculateRecommendations(
    availablePlayers,
    teamNeeds,
    limit,
    context,
    draftTimingAlternatives,
    legalPlayers,
    display
  );
  const byPosition = {} as Record<Position, RecommendationResult>;
  for (const position of POSITIONS) {
    byPosition[position] = calculateRecommendations(
      playersByPosition[position],
      teamNeeds,
      limit,
      context,
      draftTimingAlternatives,
      legalByPosition[position],
      display
    );
  }
  return { overall, byPosition };
}

function calculateRecommendations(
  availablePlayers: readonly Player[],
  teamNeeds: readonly PositionNeed[],
  limit: number,
  context?: RecommendationContext,
  draftTimingAlternatives?: DraftTimingAlternatives,
  preparedLegalPlayers?: readonly Player[],
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): RecommendationResult {
  const needsByPosition = new Map(teamNeeds.map((need) => [need.position, need]));
  const scarcityScores = calculateAllScarcityScores(availablePlayers);
  const legalPlayers = preparedLegalPlayers ?? getLegalPlayers(availablePlayers, context);
  const hasOffensivePlayers = legalPlayers.some((player) => !isSpecialTeams(player));
  const recommendationPool = shouldDeferSpecialTeams(context) && hasOffensivePlayers
    ? legalPlayers.filter((player) => !isSpecialTeams(player))
    : legalPlayers;
  const tierAvailability = calculateTierAvailability(legalPlayers);
  const availableTierAvailability = calculateTierAvailability(availablePlayers);
  const getPlayerTierAvailability = (player: Player): TierAvailability | undefined =>
    tierAvailability.get(getTierKey(player.position, player.tier));

  const bestPickPolicy = evaluateBestPickPolicy(availablePlayers, legalPlayers, {
    requirements: context?.requirements,
    rosterCounts: context?.rosterCounts,
    rosterPlayers: context?.rosterPlayers,
    selectionsRemaining: context?.selectionsRemaining,
    draftTimingAlternatives,
  });
  const draftNow = bestPickPolicy.evaluations
    .map((evaluation) => buildBestPickPolicyRecommendation(
      evaluation,
      getPlayerTierAvailability(evaluation.player),
      display
    ))
    .sort((a, b) =>
      Number(b.playerId === bestPickPolicy.preferredPlayerId) -
        Number(a.playerId === bestPickPolicy.preferredPlayerId) ||
      b.score - a.score ||
      (a.diagnostics?.expertRank ?? Number.MAX_SAFE_INTEGER) -
        (b.diagnostics?.expertRank ?? Number.MAX_SAFE_INTEGER) ||
      a.playerName.localeCompare(b.playerName) ||
      a.playerId.localeCompare(b.playerId)
    )
    .slice(0, limit);

  const rbIntentionalReaches = [...recommendationPool]
    .filter((player) => player.position === 'RB')
    .map((player) => {
      const availability = getPlayerTierAvailability(player);
      return buildRbIntentionalReachRecommendation(
        player,
        needsByPosition.get(player.position),
        scarcityScores.get(player.position) ?? 5,
        context,
        availability
      );
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const bestAvailable = [...availablePlayers]
    .map((player) => buildBestAvailableRecommendation(
      player,
      availableTierAvailability.get(getTierKey(player.position, player.tier)),
      display
    ))
    .sort((a, b) =>
      (a.diagnostics?.expertRank ?? Number.MAX_SAFE_INTEGER) -
        (b.diagnostics?.expertRank ?? Number.MAX_SAFE_INTEGER) ||
      a.playerName.localeCompare(b.playerName) ||
      a.playerId.localeCompare(b.playerId)
    )
    .slice(0, limit);

  const marketValues = [...recommendationPool]
    .filter(isActionableMarketValue)
    .map((player) => buildMarketValueRecommendation(
      player,
      getPlayerTierAvailability(player)
    ))
    .sort(sortByMarketDiscount)
    .slice(0, limit);

  const marketStashes = [...recommendationPool]
    .filter(isLateRoundStash)
    .map((player) => buildMarketValueRecommendation(
      player,
      getPlayerTierAvailability(player),
      true
    ))
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

      return buildNeedRecommendation(
        player,
        need,
        getPlayerTierAvailability(player)
      );
    })
    .filter((r): r is Recommendation => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    draftNow,
    rbIntentionalReaches,
    bestAvailable,
    marketValues,
    marketStashes,
    byNeed,
    selection: {
      preferredPlayerId: bestPickPolicy.preferredPlayerId ?? draftNow[0]?.playerId,
      policy: bestPickPolicy.feasibilityException
        ? 'roster-feasibility'
        : 'primary-league-policy',
      ecrNeighborhood: BEST_PICK_ECR_NEIGHBORHOOD,
      feasibilityException: bestPickPolicy.feasibilityException,
    },
  };
}
