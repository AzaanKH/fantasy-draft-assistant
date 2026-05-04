/**
 * Highlight level determination
 *
 * Determines how a player should be highlighted in the UI
 * based on value score, contract status, and offensive environment.
 */

import type {
  HighlightLevel,
  NFLTeam,
  TeamEnvironment,
} from '@fantasy-draft/shared';
import { isTopOffense, isDecentOffense } from '@fantasy-draft/shared';

/**
 * Determine the highlight level for a player based on multiple factors
 *
 * Rules:
 * - strong-buy: Value >= +10 AND (contract year OR top-10 offense)
 * - good-value: Value >= +5 OR contract year with decent offense (score >= 6)
 * - neutral: Default
 * - avoid: Value <= -15 (significantly overvalued)
 *
 * @param valueScore - The calculated value score (ADP - ECR)
 * @param isContractYear - Whether the player is in a contract year
 * @param teamEnvironment - The player's team offensive environment (optional)
 * @returns The appropriate highlight level
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
  // Avoid: significantly overvalued
  if (valueScore <= -15) {
    return 'avoid';
  }

  const isTop = teamEnvironment ? isTopOffense(teamEnvironment) : false;
  const isDecent = teamEnvironment ? isDecentOffense(teamEnvironment) : false;

  // Strong Buy: Great value + motivation factor (contract year OR top offense)
  if (valueScore >= 10 && (isContractYear || isTop)) {
    return 'strong-buy';
  }

  // Good Value: Solid value or contract year with decent situation
  if (valueScore >= 5) {
    return 'good-value';
  }

  if (isContractYear && isDecent) {
    return 'good-value';
  }

  return 'neutral';
}

/**
 * Convenience function to determine highlight level using player object
 * and team environments map
 *
 * @param player - Object with valueScore, isContractYear, and team properties
 * @param teamEnvironments - Map of team codes to environments
 * @returns The appropriate highlight level
 */
export function determineHighlightLevelForPlayer(
  player: {
    readonly valueScore: number;
    readonly isContractYear: boolean;
    readonly team: NFLTeam;
  },
  teamEnvironments: Map<NFLTeam, TeamEnvironment>
): HighlightLevel {
  const environment = teamEnvironments.get(player.team);
  return determineHighlightLevel(
    player.valueScore,
    player.isContractYear,
    environment
  );
}
