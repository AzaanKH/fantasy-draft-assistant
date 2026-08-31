import type { NeedPriority, RosterRequirements } from './draft';
import { DEFAULT_ROSTER_REQUIREMENTS } from './draft';
import type { Position } from './player';
import { POSITIONS } from './player';

export interface PickEvPlayer {
  readonly id: string;
  readonly position: Position;
  readonly ecrRank: number;
  readonly projectedPoints: number;
  readonly marketRank: number;
  readonly nextPickSurvivalProbability: number;
  readonly floorProjectedPoints?: number;
  readonly ceilingScore: number;
  readonly uncertaintyScore: number;
  readonly injuryRiskScore: number;
}

export interface PickEvRosterPlayer {
  readonly id: string;
  readonly position: Position;
  readonly projectedPoints: number;
  readonly ceilingScore: number;
}

export interface PickEvNeed {
  readonly position: Position;
  readonly priority: NeedPriority;
}

export interface PickEvContext {
  readonly currentPick: number;
  readonly totalPicks: number;
  readonly totalTeams: number;
  readonly requirements?: RosterRequirements;
  readonly rosterPlayers?: readonly PickEvRosterPlayer[];
  readonly rosterCounts?: Readonly<Partial<Record<Position, number>>>;
}

export interface PickEvLayers {
  readonly projection: boolean;
  readonly lineupUtility: boolean;
  readonly costOfWaiting: boolean;
  readonly lateRoundOptionValue: boolean;
  readonly risk: boolean;
}

export interface PickEvScore {
  readonly score: number;
  readonly ecrAnchorValue: number;
  readonly projectionResidualValue: number;
  readonly marginalRosterValue: number;
  readonly costOfWaiting: number;
  readonly lateRoundOptionValue: number;
  /** Informational unless the explicitly experimental risk layer is enabled. */
  readonly riskAdjustedLoss: number;
  readonly replacementPoints: number;
  readonly dynamicValueOverReplacement: number;
  readonly expectedNextPickAlternativeValue: number;
}

export interface PickEvSelection {
  readonly playerId: string | undefined;
  readonly ecrChampionId: string | undefined;
  readonly challengerId: string | undefined;
  readonly overridden: boolean;
  readonly overrideAdvantage: number;
  readonly overrideThreshold: number;
}

export const DEFAULT_PICK_EV_LAYERS: PickEvLayers = {
  projection: true,
  lineupUtility: true,
  costOfWaiting: true,
  lateRoundOptionValue: true,
  risk: false,
};

/** PickEV is a tie-breaker around ECR, not permission to make large reaches. */
export const PICK_EV_ECR_GUARDRAIL = 8;
/** Candidate threshold; live overrides remain gated by the backtest policy. */
export const PICK_EV_OVERRIDE_THRESHOLD = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle] ?? 0;
  const left = sorted[Math.max(0, middle - 1)] ?? right;
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
}

function getDraftProgress(context: PickEvContext): number {
  if (context.totalPicks <= 1) return 0;
  return clamp((context.currentPick - 1) / (context.totalPicks - 1), 0, 1);
}

function getRequirements(context: PickEvContext): RosterRequirements {
  return context.requirements ?? DEFAULT_ROSTER_REQUIREMENTS;
}

function getPositionDemand(
  position: Position,
  requirements: RosterRequirements
): number {
  const fixedDemand = requirements[position].starters;
  const flexDemand = requirements.FLEX.eligiblePositions.includes(position) &&
    requirements.FLEX.eligiblePositions.length > 0
    ? requirements.FLEX.starters / requirements.FLEX.eligiblePositions.length
    : 0;
  return Math.max(0.25, fixedDemand + flexDemand);
}

function getReplacementPoints(
  players: readonly PickEvPlayer[],
  position: Position,
  context: PickEvContext
): number {
  const positionPlayers = players
    .filter((player) => player.position === position)
    .sort((a, b) => b.projectedPoints - a.projectedPoints);
  if (positionPlayers.length === 0) return 0;

  const remainingDemandFraction = Math.max(0.15, 1 - getDraftProgress(context));
  const replacementIndex = Math.max(
    1,
    Math.round(
      getPositionDemand(position, getRequirements(context)) *
      context.totalTeams *
      remainingDemandFraction
    )
  );
  return positionPlayers[Math.min(positionPlayers.length, replacementIndex) - 1]?.projectedPoints ?? 0;
}

function getRosterPlayers(context: PickEvContext): PickEvRosterPlayer[] {
  if (context.rosterPlayers) return [...context.rosterPlayers];

  return POSITIONS.flatMap((position) =>
    Array.from({ length: context.rosterCounts?.[position] ?? 0 }, (_, index) => ({
      id: `synthetic-${position}-${String(index)}`,
      position,
      projectedPoints: 0,
      ceilingScore: 5,
    }))
  );
}

/** Maximum projected starter points permitted by the configured fixed and FLEX slots. */
export function optimizeLineupUtility(
  roster: readonly PickEvRosterPlayer[],
  requirements: RosterRequirements
): number {
  const used = new Set<string>();
  let utility = 0;

  for (const position of POSITIONS) {
    const fixed = roster
      .filter((player) => player.position === position)
      .sort((a, b) => b.projectedPoints - a.projectedPoints)
      .slice(0, requirements[position].starters);
    for (const player of fixed) {
      used.add(player.id);
      utility += player.projectedPoints;
    }
  }

  const flex = roster
    .filter((player) =>
      !used.has(player.id) && requirements.FLEX.eligiblePositions.includes(player.position)
    )
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .slice(0, requirements.FLEX.starters);
  for (const player of flex) utility += player.projectedPoints;

  return utility;
}

function getMarginalLineupUtility(
  player: PickEvPlayer,
  roster: readonly PickEvRosterPlayer[],
  requirements: RosterRequirements,
  baselineUtility: number
): number {
  return Math.max(0, optimizeLineupUtility([...roster, player], requirements) - baselineUtility);
}

function getEcrAnchorValue(ecrRank: number): number {
  return 125 * Math.exp(-Math.max(0, ecrRank - 1) / 85);
}

function getLateRoundOptionValue(
  player: PickEvPlayer,
  marginalLineupUtility: number,
  rosterSize: number,
  context: PickEvContext
): number {
  const requirements = getRequirements(context);
  const starterCount = POSITIONS.reduce(
    (total, position) => total + requirements[position].starters,
    requirements.FLEX.starters
  );
  const rosterCapacity = starterCount + requirements.BENCH.spots;
  if (rosterSize >= rosterCapacity) return 0;

  const lateWeight = clamp((getDraftProgress(context) - 0.55) / 0.45, 0, 1);
  const starterWeight = marginalLineupUtility > 0 ? 0.25 : 1;
  return Math.max(0, player.ceilingScore - 5) * 1.5 * lateWeight * starterWeight;
}

export function scorePickEvBoard(
  players: readonly PickEvPlayer[],
  _needs: readonly PickEvNeed[],
  context: PickEvContext,
  layers: PickEvLayers = DEFAULT_PICK_EV_LAYERS
): ReadonlyMap<string, PickEvScore> {
  const replacements = new Map<Position, number>();
  for (const position of POSITIONS) {
    replacements.set(position, getReplacementPoints(players, position, context));
  }

  const dynamicVor = new Map<string, number>();
  for (const player of players) {
    dynamicVor.set(
      player.id,
      Math.max(0, player.projectedPoints - (replacements.get(player.position) ?? 0))
    );
  }

  const requirements = getRequirements(context);
  const roster = getRosterPlayers(context);
  const baselineLineupUtility = optimizeLineupUtility(roster, requirements);
  const marginalUtilities = new Map<string, number>();
  for (const player of players) {
    marginalUtilities.set(
      player.id,
      getMarginalLineupUtility(player, roster, requirements, baselineLineupUtility)
    );
  }

  const rawScores = new Map<
    string,
    Omit<PickEvScore, 'score' | 'costOfWaiting' | 'expectedNextPickAlternativeValue'>
  >();
  const progress = getDraftProgress(context);
  const bestAvailableEcr = players.reduce(
    (best, player) => Math.min(best, player.ecrRank),
    Number.POSITIVE_INFINITY
  );
  for (const player of players) {
    const playerVor = dynamicVor.get(player.id) ?? 0;
    const nearbyVor = players
      .filter((candidate) => Math.abs(candidate.ecrRank - player.ecrRank) <= 8)
      .map((candidate) => dynamicVor.get(candidate.id) ?? 0);
    const projectionResidual = layers.projection ? playerVor - median(nearbyVor) : 0;
    const marginalLineupUtility = marginalUtilities.get(player.id) ?? 0;
    const marginalRosterValue = layers.lineupUtility ? marginalLineupUtility * 0.35 : 0;
    const utilityAtRisk = Math.max(marginalLineupUtility, playerVor * 0.25);
    const availabilityLoss = utilityAtRisk * clamp((player.injuryRiskScore - 2) / 13, 0, 0.6);
    const modeledFloorLoss = player.floorProjectedPoints === undefined
      ? utilityAtRisk * clamp(player.uncertaintyScore / 10, 0, 1) * 0.18
      : Math.max(0, player.projectedPoints - player.floorProjectedPoints);
    const riskLambda = 0.72 - progress * 0.34;
    const riskAdjustedLoss = (availabilityLoss + modeledFloorLoss) * riskLambda;
    const lateRoundOptionValue = layers.lateRoundOptionValue
      ? getLateRoundOptionValue(player, marginalLineupUtility, roster.length, context)
      : 0;

    rawScores.set(player.id, {
      ecrAnchorValue: getEcrAnchorValue(player.ecrRank),
      projectionResidualValue: projectionResidual * 0.25,
      marginalRosterValue,
      lateRoundOptionValue,
      riskAdjustedLoss,
      replacementPoints: replacements.get(player.position) ?? 0,
      dynamicValueOverReplacement: playerVor,
    });
  }

  const scores = new Map<string, PickEvScore>();
  for (const player of players) {
    const raw = rawScores.get(player.id);
    if (!raw) continue;
    const playerUtility = marginalUtilities.get(player.id) ?? 0;
    const expectedAlternative = players
      .filter((candidate) => candidate.id !== player.id && candidate.position === player.position)
      .reduce((best, candidate) => Math.max(
        best,
        (marginalUtilities.get(candidate.id) ?? 0) * candidate.nextPickSurvivalProbability
      ), 0);
    const rawWaitingCost = Math.max(0, playerUtility - expectedAlternative) *
      (1 - player.nextPickSurvivalProbability);
    const costOfWaiting = layers.costOfWaiting ? rawWaitingCost * 0.75 : 0;
    const score = raw.ecrAnchorValue +
      raw.projectionResidualValue +
      raw.marginalRosterValue +
      costOfWaiting +
      raw.lateRoundOptionValue -
      (layers.risk ? raw.riskAdjustedLoss : 0) -
      (player.ecrRank > bestAvailableEcr + PICK_EV_ECR_GUARDRAIL
        ? 1_000 + player.ecrRank - bestAvailableEcr - PICK_EV_ECR_GUARDRAIL
        : 0);

    scores.set(player.id, {
      score: round(score),
      ecrAnchorValue: round(raw.ecrAnchorValue),
      projectionResidualValue: round(raw.projectionResidualValue),
      marginalRosterValue: round(raw.marginalRosterValue),
      costOfWaiting: round(costOfWaiting),
      lateRoundOptionValue: round(raw.lateRoundOptionValue),
      riskAdjustedLoss: round(raw.riskAdjustedLoss),
      replacementPoints: round(raw.replacementPoints, 1),
      dynamicValueOverReplacement: round(raw.dynamicValueOverReplacement, 1),
      expectedNextPickAlternativeValue: round(expectedAlternative, 1),
    });
  }
  return scores;
}

export function selectPickEvRecommendation(
  players: readonly PickEvPlayer[],
  scores: ReadonlyMap<string, PickEvScore>,
  allowOverrides: boolean,
  overrideThreshold: number = PICK_EV_OVERRIDE_THRESHOLD
): PickEvSelection {
  const ecrChampion = [...players].sort((a, b) => a.ecrRank - b.ecrRank)[0];
  if (!ecrChampion) {
    return {
      playerId: undefined,
      ecrChampionId: undefined,
      challengerId: undefined,
      overridden: false,
      overrideAdvantage: 0,
      overrideThreshold,
    };
  }

  const eligible = players.filter(
    (player) => player.ecrRank <= ecrChampion.ecrRank + PICK_EV_ECR_GUARDRAIL
  );
  const challenger = [...eligible].sort((a, b) =>
    (scores.get(b.id)?.score ?? Number.NEGATIVE_INFINITY) -
      (scores.get(a.id)?.score ?? Number.NEGATIVE_INFINITY) ||
    a.ecrRank - b.ecrRank
  )[0] ?? ecrChampion;
  const advantage = (scores.get(challenger.id)?.score ?? 0) -
    (scores.get(ecrChampion.id)?.score ?? 0);
  const overridden = allowOverrides &&
    challenger.id !== ecrChampion.id &&
    advantage >= overrideThreshold;

  return {
    playerId: overridden ? challenger.id : ecrChampion.id,
    ecrChampionId: ecrChampion.id,
    challengerId: challenger.id,
    overridden,
    overrideAdvantage: round(advantage),
    overrideThreshold,
  };
}
