import type { HighlightLevel } from '../../player.js';
import { type TeamEnvironment, isTopOffense, isDecentOffense } from '../../team-environment.js';

/**
 * Rules:
 * - strong-buy: Value >= +10 AND (contract year OR top-10 offense)
 * - good-value: Value >= +5 OR contract year with decent offense (score >= 6)
 * - neutral: Default
 * - avoid: Value <= -15 (significantly overvalued)
 *
 * @param valueScore - The calculated value score (ADP - ECR)
 *
 * @example
 * // Great value on a top offense
 * determineHighlightLevel(12, false, { offenseScore: 9, ... }) // 'strong-buy'
 *
 * @example
 * // Contract year player on decent offense
 * determineHighlightLevel(3, true, { offenseScore: 7, ... }) // 'good-value'
 */
export function determineHighlightLevel(
  valueScore: number,
  isContractYear: boolean,
  teamEnvironment: TeamEnvironment | undefined
): HighlightLevel {
  if (valueScore <= -15) {
    return 'avoid';
  }

  const isTop = teamEnvironment ? isTopOffense(teamEnvironment) : false;
  const isDecent = teamEnvironment ? isDecentOffense(teamEnvironment) : false;

  if (valueScore >= 10 && (isContractYear || isTop)) {
    return 'strong-buy';
  }

  if (valueScore >= 5) {
    return 'good-value';
  }

  if (isContractYear && isDecent) {
    return 'good-value';
  }

  return 'neutral';
}
