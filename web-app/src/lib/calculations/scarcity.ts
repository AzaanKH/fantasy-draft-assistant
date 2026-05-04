/**
 * Positional scarcity calculation
 *
 * Measures how scarce elite players are at each position
 * based on how many elite-tier players remain available.
 */

import type { Player, Position } from '@fantasy-draft/shared';

/**
 * Elite player thresholds by position
 * Represents the ECR rank cutoff for "elite" tier at each position
 */
export const ELITE_THRESHOLDS: Record<Position, number> = {
  QB: 12,  // Top 12 QBs in 1QB league
  RB: 24,  // Need 2+ starters, scarcity matters more
  WR: 30,  // Need 2+ starters, deeper position
  TE: 10,  // Only need 1, huge dropoff after elite tier
  K: 12,   // Replaceable, but top kickers matter
  DEF: 12, // Streaming viable, but elite defenses help
};

/**
 * Calculate positional scarcity score
 *
 * Higher score = more scarce (fewer elite players available)
 * Scale: 1-10 where 10 is maximum scarcity
 *
 * @param position - The position to evaluate
 * @param availablePlayers - Array of players still available in the draft
 * @returns Scarcity score from 1 (abundant) to 10 (very scarce)
 *
 * @example
 * // All elite RBs still available (24 with ECR <= 24)
 * calculatePositionalScarcity('RB', allPlayers) // Returns 1 (not scarce)
 *
 * @example
 * // Only 2 elite TEs left (out of 10 threshold)
 * calculatePositionalScarcity('TE', fewTEsLeft) // Returns 8 (very scarce)
 */
export function calculatePositionalScarcity(
  position: Position,
  availablePlayers: readonly Player[]
): number {
  const threshold = ELITE_THRESHOLDS[position];

  // Count elite players still available at this position
  const eliteAvailable = availablePlayers.filter(
    (p) => p.position === position && p.ecrRank <= threshold
  ).length;

  // Calculate scarcity: fewer elite players = higher scarcity
  // When all elite players available: scarcity = 0
  // When no elite players available: scarcity = 10
  const scarcity = 10 - (eliteAvailable / threshold) * 10;

  // Clamp to 1-10 range
  return Math.max(1, Math.min(10, scarcity));
}

/**
 * Calculate scarcity scores for all positions
 *
 * @param availablePlayers - Array of players still available
 * @returns Map of position to scarcity score
 */
export function calculateAllScarcityScores(
  availablePlayers: readonly Player[]
): Map<Position, number> {
  const scores = new Map<Position, number>();
  const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  for (const position of positions) {
    scores.set(position, calculatePositionalScarcity(position, availablePlayers));
  }

  return scores;
}
