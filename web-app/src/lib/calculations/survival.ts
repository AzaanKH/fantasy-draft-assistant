import type { Player, Position } from '@fantasy-draft/shared';

const POSITION_LABELS: Record<Position, string> = {
  QB: 'QBs',
  RB: 'RBs',
  WR: 'WRs',
  TE: 'TEs',
  K: 'Ks',
  DEF: 'DEFs',
};

/** Primary League history remains the largest direct input to the timing estimate. */
export const RETURN_PROBABILITY_EVIDENCE_WEIGHTS = {
  leagueHistory: 0.7,
  consensusMarket: 0.25,
  sleeperTiming: 0.05,
} as const;

export interface LeagueSurvivalPositionSummary {
  readonly position: Position;
  readonly leagueMedianPick: number;
  readonly sleeperMedianPick: number;
  readonly pickPremium: number;
  readonly top50RateDelta: number;
  readonly top100RateDelta: number;
  readonly sampleSize: number;
}

export interface LeagueSurvivalAdpBucket {
  readonly label: string;
  readonly minPick: number;
  readonly maxPick: number;
  readonly positions: Record<Position, {
    readonly leaguePickRate: number;
    readonly sleeperPickRate: number;
    readonly rateDelta: number;
  }>;
}

export interface LeagueSurvivalManagerTendency {
  readonly managerKey: string;
  readonly draftSlots: readonly number[];
  readonly sampleSize: number;
  readonly positions: Record<Position, {
    readonly picks: number;
    readonly pickRate: number;
    readonly earlyPickRate: number;
    readonly leaguePickRateDelta?: number;
  }>;
}

export interface LeagueSurvivalModel {
  readonly generatedAt: string;
  readonly modelVersion: string;
  readonly leagueName: string;
  readonly seasons: readonly number[];
  readonly sampleSize: number;
  readonly positions: Record<Position, LeagueSurvivalPositionSummary>;
  /** Empirical overall pick numbers for each position across Primary League seasons. */
  readonly historicalPickNumbers?: Record<Position, readonly number[]>;
  readonly adpBuckets?: readonly LeagueSurvivalAdpBucket[];
  readonly managerTendencies?: readonly LeagueSurvivalManagerTendency[];
}

export interface SurvivalContext {
  readonly currentPick: number;
  readonly myPickPosition: number;
  readonly totalTeams: number;
  readonly totalRounds: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function round(value: number, digits: number = 1): number {
  return Number(value.toFixed(digits));
}

function quantile(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(percentile, 0, 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sorted[lowerIndex] ?? sorted[0] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (index - lowerIndex);
}

function formatRoundPick(pickNumber: number, totalTeams: number): string {
  const round = Math.ceil(pickNumber / totalTeams);
  const pickInRound = ((pickNumber - 1) % totalTeams) + 1;
  return `${String(round)}.${String(pickInRound).padStart(2, '0')}`;
}

export function getNextUserPick(context: SurvivalContext): number | null {
  const totalPicks = context.totalTeams * context.totalRounds;
  for (let pick = context.currentPick + 1; pick <= totalPicks; pick += 1) {
    const round = Math.ceil(pick / context.totalTeams);
    const pickInRound = ((pick - 1) % context.totalTeams) + 1;
    const slot = round % 2 === 1
      ? pickInRound
      : context.totalTeams - pickInRound + 1;

    if (slot === context.myPickPosition) {
      return pick;
    }
  }

  return null;
}

function getPositionTendency(
  summary: LeagueSurvivalPositionSummary | undefined
): string | undefined {
  if (!summary) return undefined;

  const label = POSITION_LABELS[summary.position];
  if (summary.pickPremium <= -6) {
    return `${label} go ${String(Math.abs(Math.round(summary.pickPremium)))} picks early here`;
  }
  if (summary.pickPremium >= 6) {
    return `${label} last ${String(Math.round(summary.pickPremium))} picks longer here`;
  }
  if (summary.top100RateDelta >= 0.08) {
    return `${label} run hotter than the broad market's top-100 pace`;
  }
  if (summary.top100RateDelta <= -0.08) {
    return `${label} run cooler than the broad market's top-100 pace`;
  }
  return `${label} track close to current market cost`;
}

function getAdpBucketPressure(
  model: LeagueSurvivalModel,
  position: Position,
  marketAdp: number
): number | null {
  const bucket = model.adpBuckets?.find(
    (candidate) => marketAdp >= candidate.minPick && marketAdp <= candidate.maxPick
  );
  const delta = bucket?.positions[position]?.rateDelta;
  return typeof delta === 'number' ? delta : null;
}

function getConsensusMarketPick(player: Player): number {
  if (isPositiveFinite(player.consensusAdp)) return player.consensusAdp;
  if (isPositiveFinite(player.marketAdp)) return player.marketAdp;
  if (isPositiveFinite(player.marketRank)) return player.marketRank;
  return player.ecrRank;
}

function getSleeperTimingPick(player: Player): number | undefined {
  if (isPositiveFinite(player.sleeperSearchRank)) return player.sleeperSearchRank;
  if (isPositiveFinite(player.sleeperAdp)) return player.sleeperAdp;
  return undefined;
}

function compareCurrentMarket(left: Player, right: Player): number {
  return getConsensusMarketPick(left) - getConsensusMarketPick(right) ||
    (getSleeperTimingPick(left) ?? Number.MAX_SAFE_INTEGER) -
      (getSleeperTimingPick(right) ?? Number.MAX_SAFE_INTEGER) ||
    left.ecrRank - right.ecrRank ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id);
}

function getCurrentPositionPercentile(
  player: Player,
  playerPool: readonly Player[]
): number {
  const positionPlayers = playerPool
    .filter((candidate) => candidate.position === player.position)
    .sort(compareCurrentMarket);
  const index = positionPlayers.findIndex((candidate) => candidate.id === player.id);
  if (index < 0 || positionPlayers.length <= 1) return 0.5;
  return index / (positionPlayers.length - 1);
}

function getHistoricalExpectedPick(
  player: Player,
  playerPool: readonly Player[],
  model: LeagueSurvivalModel,
  consensusMarketPick: number
): number {
  const empiricalPicks = model.historicalPickNumbers?.[player.position]
    ?.filter((pick) => isPositiveFinite(pick));
  if (empiricalPicks && empiricalPicks.length >= 8) {
    return quantile(
      empiricalPicks,
      getCurrentPositionPercentile(player, playerPool)
    );
  }

  // Version-one artifacts do not contain empirical samples. Preserve a
  // deterministic history-led fallback until the local model is regenerated.
  const summary = model.positions[player.position];
  const bucketPressure = getAdpBucketPressure(
    model,
    player.position,
    consensusMarketPick
  );
  const pressureAdjustment = bucketPressure !== null
    ? bucketPressure * 10
    : consensusMarketPick <= 50
      ? summary.top50RateDelta * 12
      : consensusMarketPick <= 100
        ? summary.top100RateDelta * 8
        : 0;
  return consensusMarketPick + summary.pickPremium - pressureAdjustment;
}

function getSurvivalScale(
  player: Player,
  model: LeagueSurvivalModel,
  leagueAdjustedMarketRank: number
): number {
  const empiricalPicks = model.historicalPickNumbers?.[player.position]
    ?.filter((pick) => isPositiveFinite(pick));
  if (empiricalPicks && empiricalPicks.length >= 8) {
    const interquartileRange = quantile(empiricalPicks, 0.75) -
      quantile(empiricalPicks, 0.25);
    return clamp(interquartileRange / 6, 5, 12);
  }
  return leagueAdjustedMarketRank <= 60 ? 7 : 11;
}

function withHeuristicSurvivalSource(
  player: Player,
  context: SurvivalContext
): Player {
  const nextPick = getNextUserPick(context);
  return {
    ...player,
    nextPickNumber: nextPick ?? undefined,
    nextPickLabel: nextPick === null
      ? undefined
      : formatRoundPick(nextPick, context.totalTeams),
    picksUntilNextPick: nextPick === null
      ? undefined
      : nextPick - context.currentPick,
    leagueAdjustedMarketRank: undefined,
    leagueMarketDelta: undefined,
    leaguePositionTendency: undefined,
    survivalModelSource: 'heuristic',
    historicalExpectedPick: undefined,
    consensusMarketPick: getConsensusMarketPick(player),
    sleeperTimingPick: getSleeperTimingPick(player),
    survivalModelSampleSize: undefined,
  };
}

export function estimateLeagueSurvivalProbability(
  player: Player,
  model: LeagueSurvivalModel | null | undefined,
  context: SurvivalContext,
  playerPool: readonly Player[] = [player]
): Player {
  const nextPick = getNextUserPick(context);
  if (!model || nextPick === null) {
    return withHeuristicSurvivalSource(player, context);
  }

  const summary = model.positions[player.position];
  if (!summary) return withHeuristicSurvivalSource(player, context);

  const consensusMarketPick = getConsensusMarketPick(player);
  const sleeperTimingPick = getSleeperTimingPick(player);
  const historicalExpectedPick = clamp(
    getHistoricalExpectedPick(player, playerPool, model, consensusMarketPick),
    1,
    context.totalTeams * context.totalRounds
  );
  const sleeperWeight = sleeperTimingPick === undefined
    ? 0
    : RETURN_PROBABILITY_EVIDENCE_WEIGHTS.sleeperTiming;
  const consensusWeight = RETURN_PROBABILITY_EVIDENCE_WEIGHTS.consensusMarket +
    (RETURN_PROBABILITY_EVIDENCE_WEIGHTS.sleeperTiming - sleeperWeight);
  const leagueAdjustedMarketRank = clamp(
    historicalExpectedPick * RETURN_PROBABILITY_EVIDENCE_WEIGHTS.leagueHistory +
      consensusMarketPick * consensusWeight +
      (sleeperTimingPick ?? 0) * sleeperWeight,
    1,
    context.totalTeams * context.totalRounds
  );

  const scale = getSurvivalScale(player, model, leagueAdjustedMarketRank);
  const draftedByCurrentPick = logistic(
    (context.currentPick - leagueAdjustedMarketRank) / scale
  );
  const draftedByNextPick = logistic(
    (nextPick - leagueAdjustedMarketRank) / scale
  );
  const stillAvailableAtCurrentPick = Math.max(0.03, 1 - draftedByCurrentPick);
  const conditionalSurvival = (1 - draftedByNextPick) /
    stillAvailableAtCurrentPick;
  const nextPickSurvivalProbability = round(
    clamp(conditionalSurvival, 0.03, 0.97),
    2
  );

  return {
    ...player,
    nextPickSurvivalProbability,
    nextPickNumber: nextPick,
    nextPickLabel: formatRoundPick(nextPick, context.totalTeams),
    picksUntilNextPick: nextPick - context.currentPick,
    leagueAdjustedMarketRank: round(leagueAdjustedMarketRank),
    leagueMarketDelta: round(leagueAdjustedMarketRank - consensusMarketPick),
    leaguePositionTendency: getPositionTendency(summary),
    survivalModelSource: 'league-history',
    historicalExpectedPick: round(historicalExpectedPick),
    consensusMarketPick: round(consensusMarketPick),
    sleeperTimingPick: sleeperTimingPick === undefined
      ? undefined
      : round(sleeperTimingPick),
    survivalModelSampleSize:
      model.historicalPickNumbers?.[player.position]?.length ?? summary.sampleSize,
  };
}

export function applyLeagueSurvivalModel(
  players: readonly Player[],
  model: LeagueSurvivalModel | null | undefined,
  context: SurvivalContext
): Player[] {
  return players.map((player) =>
    estimateLeagueSurvivalProbability(player, model, context, players)
  );
}
