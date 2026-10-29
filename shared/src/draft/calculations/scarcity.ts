import type { Player } from '../../player.js';
import { POSITIONS, type Position } from '../../league/positions.js';

/**
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
 * Higher score = more scarce (fewer elite players available)
 * Scale: 1-10 where 10 is maximum scarcity
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

  const eliteAvailable = availablePlayers.filter(
    (p) => p.position === position && p.positionalRank <= threshold
  ).length;

  const scarcity = 10 - (eliteAvailable / threshold) * 10;

  return Math.max(1, Math.min(10, scarcity));
}

export function calculateAllScarcityScores(
  availablePlayers: readonly Player[]
): Map<Position, number> {
  const scores = new Map<Position, number>();
  for (const position of POSITIONS) {
    scores.set(position, calculatePositionalScarcity(position, availablePlayers));
  }

  return scores;
}
