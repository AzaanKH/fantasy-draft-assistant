import type {
  FantasyProsProjection,
  NewsStatus,
  PlayerPrediction,
  Player,
  Position,
  PredictionSource,
  RosterRequirements,
} from '@fantasy-draft/shared';
import { DEFAULT_ROSTER_REQUIREMENTS } from '@fantasy-draft/shared';

const REPLACEMENT_POSITIONAL_RANKS: Record<Position, number> = {
  QB: 12,
  RB: 30,
  WR: 30,
  TE: 14,
  K: 12,
  DEF: 12,
};

interface PredictionInput {
  readonly position: Position;
  readonly ecrRank: number;
  readonly positionalRank: number;
  readonly sleeperAdp: number;
  readonly offenseScore: number;
  readonly valueScore: number;
  readonly isContractYear: boolean;
  readonly age: number | null | undefined;
  readonly yearsExp: number | null | undefined;
  readonly sleeperStatus: string | undefined;
  readonly newsStatus: NewsStatus;
  readonly fantasyProsProjection?: FantasyProsProjection;
  /** FantasyPros PPR baseline after applying the active local league rules. */
  readonly localLeagueProjectedPoints?: number;
  readonly modelPrediction?: PlayerPrediction;
  /** Risk-only model output that must not promote experimental point projections. */
  readonly informationalRiskPrediction?: PlayerPrediction;
}

export interface PredictionLayerResult {
  readonly projectedPoints: number;
  readonly valueOverReplacement: number;
  readonly ceilingScore: number;
  readonly floorScore: number;
  readonly upsideScore: number;
  readonly uncertaintyScore: number;
  readonly injuryRiskScore: number;
  readonly predictionSource: PredictionSource;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number = 1): number {
  return Number(value.toFixed(digits));
}

function rankProjection(ecrRank: number, sleeperAdp: number, offenseScore: number): number {
  const rankScore = Math.max(0, 300 - ecrRank);
  const marketScore = Math.max(0, 300 - sleeperAdp);
  return round(rankScore * 0.45 + marketScore * 0.35 + offenseScore * 8);
}

function replacementProjection(position: Position, offenseScore: number): number {
  const replacementRank = REPLACEMENT_POSITIONAL_RANKS[position];
  return rankProjection(replacementRank * 2.8, replacementRank * 2.8, offenseScore);
}

function getExperienceUncertainty(age: number | null | undefined, yearsExp: number | null | undefined): number {
  if (yearsExp === 0) return 2.2;
  if (yearsExp === 1) return 1.3;
  if (yearsExp === 2) return 0.7;
  if (yearsExp == null) return age != null && age <= 23 ? 1.4 : 0.8;
  return 0;
}

function getInjuryRisk(newsStatus: NewsStatus, sleeperStatus: string | undefined): number {
  const status = sleeperStatus?.toLowerCase() ?? '';

  if (newsStatus === 'out' || status.includes('inactive') || status.includes('injured reserve')) return 9;
  if (status.includes('pup') || status.includes('nfi')) return 8;
  if (newsStatus === 'limited') return 5;
  if (newsStatus === 'questionable') return 6.5;
  if (newsStatus === 'healthy' || /\bactive\b/.test(status)) return 2;
  return 2;
}

function scoreFromPoints(points: number, basePoints: number, sensitivity: number): number {
  return clamp(5 + (points - basePoints) / sensitivity, 1, 10);
}

export function estimatePlayerPrediction(input: PredictionInput): PredictionLayerResult {
  const model = input.modelPrediction;
  const riskModel = model ?? input.informationalRiskPrediction;
  const source: PredictionSource = model
    ? 'model'
    : input.fantasyProsProjection
      ? 'fantasypros'
      : 'heuristic';

  const baseProjectedPoints =
    model?.customProjectedPoints ??
    model?.projectedPoints ??
    input.localLeagueProjectedPoints ??
    input.fantasyProsProjection?.projectedPoints ??
    rankProjection(input.ecrRank, input.sleeperAdp, input.offenseScore);

  const injuryRiskScore = clamp(
    riskModel?.injuryRiskScore ??
      riskModel?.riskScore ??
      getInjuryRisk(input.newsStatus, input.sleeperStatus),
    1,
    10
  );
  const experienceUncertainty = getExperienceUncertainty(input.age, input.yearsExp);
  const uncertaintyScore = clamp(
    riskModel?.uncertaintyScore ??
      2.4 +
        experienceUncertainty +
        Math.abs(input.valueScore) / 18 +
        Math.max(0, injuryRiskScore - 4) * 0.45,
    1,
    10
  );

  // A current injury report affects risk, not a full-season projection. This
  // prevents an offseason/practice status from erasing months of expected value.
  const projectedPoints = round(baseProjectedPoints);
  const replacementPoints = replacementProjection(input.position, input.offenseScore);
  const valueOverReplacement = round(
    model?.valueOverReplacement ?? Math.max(0, projectedPoints - replacementPoints),
    1
  );

  const ceilingPoints =
    input.fantasyProsProjection?.ceilingPoints ??
    projectedPoints + 12 + uncertaintyScore * 3 + input.offenseScore * 1.4;
  const floorPoints =
    input.fantasyProsProjection?.floorPoints ??
    projectedPoints - 10 - uncertaintyScore * 3.5 - injuryRiskScore * 1.6;

  const ceilingScore = round(
    model?.ceilingScore ??
      clamp(
        scoreFromPoints(ceilingPoints, replacementPoints, 18) +
          (input.yearsExp === 0 ? 0.5 : 0) +
          (input.isContractYear ? 0.3 : 0),
        1,
        10
      )
  );
  const floorScore = round(
    model?.floorScore ??
      clamp(scoreFromPoints(floorPoints, replacementPoints, 16) - Math.max(0, injuryRiskScore - 5) * 0.25, 1, 10)
  );
  const upsideScore = round(clamp((ceilingScore * 0.7 + input.offenseScore * 0.3), 1, 10));

  return {
    projectedPoints,
    valueOverReplacement,
    ceilingScore,
    floorScore,
    upsideScore,
    uncertaintyScore: round(uncertaintyScore),
    injuryRiskScore: round(injuryRiskScore),
    predictionSource: source,
  };
}

/**
 * Recalculate VOR from the actual league-scored projection pool. Small fixture
 * pools retain their supplied VOR because they cannot contain a replacement
 * player at the configured league rank.
 */
export function applyDynamicValueOverReplacement(
  players: readonly Player[],
  totalTeams: number = 10,
  requirements: RosterRequirements = DEFAULT_ROSTER_REQUIREMENTS
): Player[] {
  const normalizedTeams = Math.max(2, Math.round(totalTeams));
  const starterDemand = new Map<Position, number>();
  const fixedStarterIds = new Set<string>();

  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const) {
    const demand = normalizedTeams * requirements[position].starters;
    starterDemand.set(position, demand);
    const positionPlayers = players
      .filter((player) => player.position === position)
      .sort((a, b) => b.projectedPoints - a.projectedPoints || a.ecrRank - b.ecrRank);
    for (const player of positionPlayers.slice(0, demand)) {
      fixedStarterIds.add(player.id);
    }
  }

  const flexDemand = normalizedTeams * requirements.FLEX.starters;
  const flexCandidates = players
    .filter(
      (player) =>
        requirements.FLEX.eligiblePositions.includes(player.position) &&
        !fixedStarterIds.has(player.id)
    )
    .sort((a, b) => b.projectedPoints - a.projectedPoints || a.ecrRank - b.ecrRank)
    .slice(0, flexDemand);
  for (const player of flexCandidates) {
    starterDemand.set(
      player.position,
      (starterDemand.get(player.position) ?? 0) + 1
    );
  }

  const replacementPoints = new Map<Position, number>();
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const) {
    const positionPlayers = players
      .filter((player) => player.position === position)
      .sort((a, b) => b.projectedPoints - a.projectedPoints);
    const replacementIndex = starterDemand.get(position) ?? 0;
    if (replacementIndex > 0 && positionPlayers.length > replacementIndex) {
      replacementPoints.set(
        position,
        positionPlayers[replacementIndex]?.projectedPoints ?? 0
      );
    }
  }

  return players.map((player) => {
    const replacement = replacementPoints.get(player.position);
    return replacement === undefined
      ? player
      : {
          ...player,
          valueOverReplacement: round(Math.max(0, player.projectedPoints - replacement)),
        };
  });
}
