import type {
  FantasyProsProjection,
  Position,
  ScoringRules,
} from '@fantasy-draft/shared';

/** FantasyPros PPR defaults used by the published projection total. */
const PPR_BASELINE = {
  passingYard: 0.04,
  passingTouchdown: 4,
  rushingYard: 0.1,
  rushingTouchdown: 6,
  reception: 1,
  receivingYard: 0.1,
  receivingTouchdown: 6,
} as const;

export interface LeagueProjectionResult {
  readonly projectedPoints: number;
  readonly adjustment: number;
}

function contribution(
  stat: number | undefined,
  leagueRate: number,
  baselineRate: number
): number {
  return stat === undefined ? 0 : stat * (leagueRate - baselineRate);
}

/**
 * Re-scores a FantasyPros full-PPR projection from its stat components. The
 * PPR total stays the source baseline; only rule deltas supported by the
 * projection components are added or removed locally.
 */
export function calculateLeagueProjection(
  projection: FantasyProsProjection,
  position: Position,
  rules: ScoringRules
): LeagueProjectionResult {
  const basePoints = projection.baseProjectedPoints ?? projection.projectedPoints;
  const receptions = projection.projectedReceptions;
  const adjustment =
    contribution(
      projection.projectedPassingYards,
      rules.passing.yardsPerPoint,
      PPR_BASELINE.passingYard
    ) +
    contribution(
      projection.projectedPassingTouchdowns,
      rules.passing.touchdown,
      PPR_BASELINE.passingTouchdown
    ) +
    contribution(
      projection.projectedRushingYards,
      rules.rushing.yardsPerPoint,
      PPR_BASELINE.rushingYard
    ) +
    contribution(
      projection.projectedRushingTouchdowns,
      rules.rushing.touchdown,
      PPR_BASELINE.rushingTouchdown
    ) +
    contribution(
      receptions,
      rules.receiving.reception,
      PPR_BASELINE.reception
    ) +
    contribution(
      projection.projectedReceivingYards,
      rules.receiving.yardsPerPoint,
      PPR_BASELINE.receivingYard
    ) +
    contribution(
      projection.projectedReceivingTouchdowns,
      rules.receiving.touchdown,
      PPR_BASELINE.receivingTouchdown
    ) +
    (projection.projectedRushAttempts ?? 0) * rules.rushing.attemptBonus +
    (position === 'TE' ? (receptions ?? 0) * rules.receiving.tePremium : 0);

  return {
    projectedPoints: Number((basePoints + adjustment).toFixed(2)),
    adjustment: Number(adjustment.toFixed(2)),
  };
}
