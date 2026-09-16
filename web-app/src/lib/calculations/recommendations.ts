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
  Position,
  PickEvScore,
  PickEvRosterPlayer,
  PickEvSelection,
  RosterRequirements,
} from '@fantasy-draft/shared';
import { scorePickEvBoard, selectPickEvRecommendation } from '@fantasy-draft/shared';
import { calculateAllScarcityScores } from './scarcity';
import {
  calculateTierAvailability,
  getTierKey,
  type TierAvailability,
} from './tiers';
import {
  getDraftProgress,
  isSpecialTeamsPosition,
  shouldDeferSpecialTeams,
  SPECIAL_TEAMS_LATE_DRAFT_PROGRESS,
} from './draft-stage';
import {
  BEST_PICK_ECR_NEIGHBORHOOD,
  evaluateBestPickPolicy,
  type BestPickPolicyEvaluation,
} from './best-pick-policy';

type RecommendationDiagnostics = NonNullable<Recommendation['diagnostics']>;
type RecommendationSubScores = NonNullable<Recommendation['subScores']>;

export interface RecommendationContext {
  readonly currentPick?: number;
  readonly totalPicks?: number;
  readonly isMyTurn?: boolean;
  readonly totalTeams?: number;
  readonly architecture?: 'legacy' | 'pick-ev' | 'best-pick-policy';
  readonly requirements?: RosterRequirements;
  readonly rosterPlayers?: readonly PickEvRosterPlayer[];
  readonly rosterCounts?: Readonly<Partial<Record<Position, number>>>;
  /** Manager selections left, including the current selection. */
  readonly selectionsRemaining?: number;
  readonly allowPickEvOverrides?: boolean;
  readonly pickEvOverrideThreshold?: number;
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

export type RecommendationSelectionPolicy =
  | 'ecr-anchor'
  | 'pick-ev-override'
  | 'league-aware-score'
  | 'primary-league-policy'
  | 'roster-feasibility';

export interface RecommendationSelection {
  readonly preferredPlayerId?: string;
  readonly policy: RecommendationSelectionPolicy;
  readonly overrideThreshold?: number;
  readonly overrideAdvantage?: number;
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
  recommendation: Recommendation,
  player: Player,
  context: RecommendationContext | undefined,
  tierAvailability: TierAvailability | undefined
): Recommendation {
  const marketReachCost = getMarketReachCost(player, context);
  const survivalPercent = Math.round(player.nextPickSurvivalProbability * 100);
  const label = marketReachCost > 0
    ? 'Over market price, but correct for roster/scarcity'
    : 'At market price and correct for roster/scarcity';

  return {
    ...recommendation,
    reason: [
      label,
      `custom VOR ${recommendation.diagnostics?.valueOverReplacement.toFixed(1) ?? '0.0'}`,
      getTierReason(player, tierAvailability),
      `${String(survivalPercent)}% to next pick`,
      `market reach cost ${marketReachCost.toFixed(1)} picks`,
    ].join(' · '),
    diagnostics: {
      ...getDiagnostics(player, tierAvailability),
      ...recommendation.diagnostics,
      marketReachCost,
    },
  };
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
  context: RecommendationContext | undefined,
  tierAvailability: TierAvailability | undefined
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
      getTierReason(player, tierAvailability),
      `VOR ${getGuardedValueOverReplacement(player).toFixed(1)}`,
      formatMarketDelta(player.valueScore),
      survivalText,
    ].join(' · '),
    score: round(sumBaseSubScores(subScores)),
    diagnostics: getDiagnostics(player, tierAvailability),
    subScores,
  };
}

function buildPickEvRecommendation(
  player: Player,
  need: PositionNeed | undefined,
  pickEv: PickEvScore,
  selection: PickEvSelection | undefined,
  tierAvailability: TierAvailability | undefined
): Recommendation {
  const survivalPercent = Math.round(player.nextPickSurvivalProbability * 100);
  const subScores: RecommendationSubScores = {
    expertRankScore: pickEv.ecrAnchorValue,
    marketValueScore: 0,
    projectionScore: pickEv.projectionResidualValue,
    replacementScore: pickEv.marginalRosterValue,
    upsideScore: 0,
    tierUrgencyScore: 0,
    survivalScore: pickEv.costOfWaiting,
    riskPenalty: pickEv.riskAdjustedLoss,
    uncertaintyPenalty: 0,
    pickEv: pickEv.score,
    ecrAnchorValue: pickEv.ecrAnchorValue,
    projectionResidualValue: pickEv.projectionResidualValue,
    marginalRosterValue: pickEv.marginalRosterValue,
    costOfWaiting: pickEv.costOfWaiting,
    lateRoundOptionValue: pickEv.lateRoundOptionValue,
    riskAdjustedLoss: pickEv.riskAdjustedLoss,
  };
  const selectionText = selection?.playerId === player.id
    ? selection.overridden
      ? `PickEV override +${selection.overrideAdvantage.toFixed(1)}`
      : 'ECR champion'
    : `PickEV ${pickEv.score.toFixed(1)}`;

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: [
      selectionText,
      getTierReason(player, tierAvailability),
      getNeedReason(need),
      `dynamic VOR ${pickEv.dynamicValueOverReplacement.toFixed(1)}`,
      `${String(survivalPercent)}% to next pick`,
      `wait cost ${pickEv.costOfWaiting.toFixed(1)}`,
      `option ${pickEv.lateRoundOptionValue.toFixed(1)}`,
      `risk info ${pickEv.riskAdjustedLoss.toFixed(1)}`,
    ].join(' · '),
    score: pickEv.score,
    diagnostics: {
      ...getDiagnostics(player, tierAvailability),
      valueOverReplacement: pickEv.dynamicValueOverReplacement,
      pickEv: pickEv.score,
      ecrAnchorValue: pickEv.ecrAnchorValue,
      projectionResidualValue: pickEv.projectionResidualValue,
      marginalRosterValue: pickEv.marginalRosterValue,
      costOfWaiting: pickEv.costOfWaiting,
      lateRoundOptionValue: pickEv.lateRoundOptionValue,
      riskAdjustedLoss: pickEv.riskAdjustedLoss,
      replacementPoints: pickEv.replacementPoints,
      expectedNextPickAlternativeValue: pickEv.expectedNextPickAlternativeValue,
    },
    subScores,
  };
}

function buildBestPickPolicyRecommendation(
  evaluation: BestPickPolicyEvaluation,
  tierAvailability: TierAvailability | undefined
): Recommendation {
  const { player, factors } = evaluation;
  const feasibilityLabel = factors.conservativeBoundary.feasibilityException
    ? 'Legal-roster requirement'
    : factors.conservativeBoundary.withinBoundary
      ? 'Conservative ECR adjustment'
      : 'Outside normal ECR window';

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: [
      feasibilityLabel,
      `ECR #${String(player.ecrRank)}`,
      `league value +${factors.leagueValue.score.toFixed(1)}/${factors.leagueValue.maxScore.toFixed(0)}`,
      `roster fit +${factors.rosterFit.score.toFixed(1)}/${factors.rosterFit.maxScore.toFixed(0)}`,
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
  tierAvailability: TierAvailability | undefined
): Recommendation {
  const diagnostics = getDiagnostics(player, tierAvailability);

  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    reason: `Trusted ECR Anchor #${String(player.ecrRank)} among available players`,
    // This score is intentionally ECR-only. Diagnostics remain available for
    // comparison, but roster, timing, market, and model signals cannot reorder it.
    score: -player.ecrRank,
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
  context?: RecommendationContext
): RecommendationResult {
  const needsByPosition = new Map(teamNeeds.map((need) => [need.position, need]));
  const scarcityScores = calculateAllScarcityScores(availablePlayers);
  const requirements = context?.requirements;
  const legalPlayers = requirements
    ? availablePlayers.filter((player) =>
        (context.rosterCounts?.[player.position] ?? 0) <
          requirements[player.position].max
      )
    : availablePlayers;
  const hasOffensivePlayers = legalPlayers.some((player) => !isSpecialTeams(player));
  const recommendationPool = shouldDeferSpecialTeams(context) && hasOffensivePlayers
    ? legalPlayers.filter((player) => !isSpecialTeams(player))
    : legalPlayers;
  const bestPickCandidatePool = context?.architecture === 'best-pick-policy'
    ? legalPlayers
    : recommendationPool;
  const tierAvailability = calculateTierAvailability(bestPickCandidatePool);
  const availableTierAvailability = calculateTierAvailability(availablePlayers);
  const getPlayerTierAvailability = (player: Player): TierAvailability | undefined =>
    tierAvailability.get(getTierKey(player.position, player.tier));

  const pickEvPool = context?.architecture === 'pick-ev'
    ? recommendationPool.filter((player) =>
        needsByPosition.get(player.position)?.priority !== 'filled'
      )
    : recommendationPool;
  const pickEvScores = context?.architecture === 'pick-ev'
    ? scorePickEvBoard(pickEvPool, teamNeeds, {
        currentPick: context.currentPick ?? 1,
        totalPicks: context.totalPicks ?? 150,
        totalTeams: context.totalTeams ?? 10,
        requirements: context.requirements,
        rosterPlayers: context.rosterPlayers,
        rosterCounts: context.rosterCounts,
      })
    : null;
  const pickEvSelection = pickEvScores
    ? selectPickEvRecommendation(
        pickEvPool,
        pickEvScores,
        context?.allowPickEvOverrides ?? false,
        context?.pickEvOverrideThreshold
      )
    : undefined;
  const bestPickPolicy = context?.architecture === 'best-pick-policy'
    ? evaluateBestPickPolicy(availablePlayers, bestPickCandidatePool, {
        requirements: context.requirements,
        rosterCounts: context.rosterCounts,
        selectionsRemaining: context.selectionsRemaining,
      })
    : undefined;
  const policyEvaluationById = new Map(
    bestPickPolicy?.evaluations.map((evaluation) => [
      evaluation.player.id,
      evaluation,
    ]) ?? []
  );
  const draftNowPool = bestPickPolicy
    ? bestPickPolicy.evaluations.map((evaluation) => evaluation.player)
    : context?.architecture === 'pick-ev'
      ? pickEvPool
      : recommendationPool;
  const draftNow = [...draftNowPool]
    .map((player) => {
      const policyEvaluation = policyEvaluationById.get(player.id);
      if (policyEvaluation) {
        return buildBestPickPolicyRecommendation(
          policyEvaluation,
          getPlayerTierAvailability(player)
        );
      }
      const pickEv = pickEvScores?.get(player.id);
      return pickEv
        ? buildPickEvRecommendation(
            player,
            needsByPosition.get(player.position),
            pickEv,
            pickEvSelection,
            getPlayerTierAvailability(player)
          )
        : buildDraftNowRecommendation(
            player,
            needsByPosition.get(player.position),
            scarcityScores.get(player.position) ?? 5,
            context,
            getPlayerTierAvailability(player)
          );
    })
    .sort((a, b) =>
      Number(b.playerId === (bestPickPolicy?.preferredPlayerId ?? pickEvSelection?.playerId)) -
        Number(a.playerId === (bestPickPolicy?.preferredPlayerId ?? pickEvSelection?.playerId)) ||
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
      const pickEv = pickEvScores?.get(player.id);
      const availability = getPlayerTierAvailability(player);
      const recommendation = pickEv
        ? buildPickEvRecommendation(
            player,
            needsByPosition.get(player.position),
            pickEv,
            pickEvSelection,
            availability
          )
        : buildDraftNowRecommendation(
            player,
            needsByPosition.get(player.position),
            scarcityScores.get(player.position) ?? 5,
            context,
            availability
          );
      return buildRbIntentionalReachRecommendation(
        recommendation,
        player,
        context,
        availability
      );
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const bestAvailable = [...availablePlayers]
    .map((player) => buildBestAvailableRecommendation(
      player,
      availableTierAvailability.get(getTierKey(player.position, player.tier))
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
      preferredPlayerId:
        bestPickPolicy?.preferredPlayerId ??
        pickEvSelection?.playerId ??
        draftNow[0]?.playerId,
      policy: bestPickPolicy
        ? bestPickPolicy.feasibilityException
          ? 'roster-feasibility'
          : 'primary-league-policy'
        : pickEvSelection
          ? pickEvSelection.overridden
            ? 'pick-ev-override'
            : 'ecr-anchor'
          : 'league-aware-score',
      overrideThreshold: pickEvSelection?.overrideThreshold,
      overrideAdvantage: pickEvSelection?.overrideAdvantage,
      ecrNeighborhood: bestPickPolicy
        ? BEST_PICK_ECR_NEIGHBORHOOD
        : undefined,
      feasibilityException: bestPickPolicy?.feasibilityException,
    },
  };
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
