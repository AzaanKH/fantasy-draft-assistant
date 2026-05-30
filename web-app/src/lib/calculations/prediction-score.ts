import type {
  FantasyProsProjection,
  NewsStatus,
  PlayerPrediction,
  Position,
  PredictionSource,
} from '@fantasy-draft/shared';

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
  readonly modelPrediction?: PlayerPrediction;
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

function getAvailabilityMultiplier(newsStatus: NewsStatus): number {
  if (newsStatus === 'out') return 0.55;
  if (newsStatus === 'questionable') return 0.9;
  if (newsStatus === 'limited') return 0.95;
  return 1;
}

function scoreFromPoints(points: number, basePoints: number, sensitivity: number): number {
  return clamp(5 + (points - basePoints) / sensitivity, 1, 10);
}

export function estimatePlayerPrediction(input: PredictionInput): PredictionLayerResult {
  const model = input.modelPrediction;
  const source: PredictionSource = model
    ? 'model'
    : input.fantasyProsProjection
      ? 'fantasypros'
      : 'heuristic';

  const baseProjectedPoints =
    model?.projectedPoints ??
    input.fantasyProsProjection?.projectedPoints ??
    rankProjection(input.ecrRank, input.sleeperAdp, input.offenseScore);

  const injuryRiskScore = clamp(
    model?.injuryRiskScore ?? model?.riskScore ?? getInjuryRisk(input.newsStatus, input.sleeperStatus),
    1,
    10
  );
  const experienceUncertainty = getExperienceUncertainty(input.age, input.yearsExp);
  const uncertaintyScore = clamp(
    model?.uncertaintyScore ??
      2.4 +
        experienceUncertainty +
        Math.abs(input.valueScore) / 18 +
        Math.max(0, injuryRiskScore - 4) * 0.45,
    1,
    10
  );

  const projectedPoints = round(baseProjectedPoints * getAvailabilityMultiplier(input.newsStatus));
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
