import type { Player } from '@fantasy-draft/shared';

export const RISK_LEVELS = ['low', 'moderate', 'high', 'very-high'] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface PlayerRiskAssessment {
  readonly score: number;
  readonly level: RiskLevel;
  readonly label: string;
  readonly availability: number;
  readonly volatility: number;
  readonly driver: 'availability' | 'volatility' | 'mixed';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Availability is the primary risk signal. Projection volatility adds risk
 * above its neutral baseline without replacing or hiding availability risk.
 */
export function calculatePlayerRisk(
  player: Pick<Player, 'injuryRiskScore' | 'uncertaintyScore'>
): PlayerRiskAssessment {
  const availability = clamp(player.injuryRiskScore, 1, 10);
  const volatility = clamp(player.uncertaintyScore, 1, 10);
  const score = Number(
    clamp(availability + Math.max(0, volatility - 2) * 0.35, 1, 10).toFixed(1)
  );
  const level: RiskLevel =
    score >= 7.5
      ? 'very-high'
      : score >= 5.5
        ? 'high'
        : score >= 3.5
          ? 'moderate'
          : 'low';
  const driver =
    availability >= volatility + 0.75
      ? 'availability'
      : volatility >= availability + 0.75
        ? 'volatility'
        : 'mixed';

  return {
    score,
    level,
    label: {
      low: 'Low',
      moderate: 'Moderate',
      high: 'High',
      'very-high': 'Very high',
    }[level],
    availability,
    volatility,
    driver,
  };
}

