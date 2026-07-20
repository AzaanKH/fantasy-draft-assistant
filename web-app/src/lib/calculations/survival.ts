import type { Player, Position } from '@fantasy-draft/shared';

const POSITION_LABELS: Record<Position, string> = {
  QB: 'QBs',
  RB: 'RBs',
  WR: 'WRs',
  TE: 'TEs',
  K: 'Ks',
  DEF: 'DEFs',
};

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

function getPositionTendency(summary: LeagueSurvivalPositionSummary | undefined): string | undefined {
  if (!summary) {
    return undefined;
  }

  const label = POSITION_LABELS[summary.position];
  if (summary.pickPremium <= -6) {
    return `${label} go ${Math.abs(Math.round(summary.pickPremium))} picks early here`;
  }
  if (summary.pickPremium >= 6) {
    return `${label} last ${Math.round(summary.pickPremium)} picks longer here`;
  }
  if (summary.top100RateDelta >= 0.08) {
    return `${label} run hotter than Sleeper top-100 pace`;
  }
  if (summary.top100RateDelta <= -0.08) {
    return `${label} run cooler than Sleeper top-100 pace`;
  }
  return `${label} track close to Sleeper ADP`;
}

function getAdpBucketPressure(
  model: LeagueSurvivalModel,
  position: Position,
  sleeperAdp: number
): number | null {
  const bucket = model.adpBuckets?.find(
    (candidate) => sleeperAdp >= candidate.minPick && sleeperAdp <= candidate.maxPick
  );
  const delta = bucket?.positions[position]?.rateDelta;
  return typeof delta === 'number' ? delta : null;
}

function withHeuristicSurvivalSource(player: Player): Player {
  return {
    ...player,
    leagueAdjustedMarketRank: undefined,
    leagueMarketDelta: undefined,
    leaguePositionTendency: undefined,
    survivalModelSource: 'heuristic',
  };
}

export function estimateLeagueSurvivalProbability(
  player: Player,
  model: LeagueSurvivalModel | null | undefined,
  context: SurvivalContext
): Player {
  const nextPick = getNextUserPick(context);
  if (!model || nextPick === null) {
    return withHeuristicSurvivalSource(player);
  }

  const summary = model.positions[player.position];
  if (!summary) {
    return withHeuristicSurvivalSource(player);
  }

  const marketAdp = player.marketAdp;
  const bucketPressure = getAdpBucketPressure(model, player.position, marketAdp);
  const earlyBucketPressure = bucketPressure !== null
    ? bucketPressure * 10
    : marketAdp <= 50
      ? summary.top50RateDelta * 12
      : marketAdp <= 100
        ? summary.top100RateDelta * 8
        : 0;
  const leagueAdjustedMarketRank = clamp(
    marketAdp + summary.pickPremium - earlyBucketPressure,
    1,
    context.totalTeams * context.totalRounds
  );

  const scale = marketAdp <= 60 ? 7 : 11;
  const draftedByCurrentPick = logistic((context.currentPick - leagueAdjustedMarketRank) / scale);
  const draftedByNextPick = logistic((nextPick - leagueAdjustedMarketRank) / scale);
  const stillAvailableAtCurrentPick = Math.max(0.05, 1 - draftedByCurrentPick);
  const conditionalSurvival = (1 - draftedByNextPick) / stillAvailableAtCurrentPick;
  const nextPickSurvivalProbability = Number(clamp(conditionalSurvival, 0.03, 0.97).toFixed(2));

  return {
    ...player,
    nextPickSurvivalProbability,
    leagueAdjustedMarketRank: Number(leagueAdjustedMarketRank.toFixed(1)),
    leagueMarketDelta: Number((leagueAdjustedMarketRank - marketAdp).toFixed(1)),
    leaguePositionTendency: getPositionTendency(summary),
    survivalModelSource: 'league-history',
  };
}

export function applyLeagueSurvivalModel(
  players: readonly Player[],
  model: LeagueSurvivalModel | null | undefined,
  context: SurvivalContext
): Player[] {
  return players.map((player) => estimateLeagueSurvivalProbability(player, model, context));
}
