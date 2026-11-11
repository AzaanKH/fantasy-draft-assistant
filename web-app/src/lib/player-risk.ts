import type { Player } from '@fantasy-draft/shared/league';

export type RiskLevel = 'low' | 'elevated' | 'high';

export interface PlayerRisk {
  readonly level: RiskLevel;
  /** Chip text. */
  readonly label: string;
  /** Tooltip and accessible description naming the scores behind the level. */
  readonly detail: string;
}

/** Display-only cut points on the catalog's 1–10 scores. They label risk; they never reorder recommendations. */
const DISPLAY_ONLY_RISK_THRESHOLDS = { elevated: 5, high: 7 } as const;

const SOURCE_LABELS: Readonly<Record<Player['predictionSource'], string>> = {
  model: 'risk model',
  fantasypros: 'FantasyPros-based estimate',
  heuristic: 'heuristic estimate',
};

/**
 * Risk from the catalog's injury-risk and projection-uncertainty scores (1–10, higher is riskier).
 * The level follows the higher of the two, so a durable player with a wide projection still reads as risky.
 */
export function getPlayerRisk(player: Pick<Player, 'injuryRiskScore' | 'uncertaintyScore' | 'predictionSource'>): PlayerRisk | null {
  const { injuryRiskScore: injury, uncertaintyScore: uncertainty } = player;
  if (!Number.isFinite(injury) || !Number.isFinite(uncertainty)) return null;
  const score = Math.max(injury, uncertainty);
  const level: RiskLevel = score >= DISPLAY_ONLY_RISK_THRESHOLDS.high
    ? 'high'
    : score >= DISPLAY_ONLY_RISK_THRESHOLDS.elevated ? 'elevated' : 'low';
  const label = level === 'high' ? 'High risk' : level === 'elevated' ? 'Some risk' : 'Low risk';
  const detail = `${label}: injury risk ${injury.toFixed(1)}/10, projection uncertainty ${uncertainty.toFixed(1)}/10 (${SOURCE_LABELS[player.predictionSource]})`;
  return { level, label, detail };
}
