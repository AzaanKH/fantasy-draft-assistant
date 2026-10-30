import type { Player } from '../../player.js';
import { POSITIONS, type Position } from '../../league/positions.js';

export const ELITE_POSITIONAL_RANK_CUTOFFS: Record<Position, number> = {
  QB: 12,  // Top 12 QBs in 1QB league
  RB: 24,  // Need 2+ starters, scarcity matters more
  WR: 30,  // Need 2+ starters, deeper position
  TE: 10,  // Only need 1, huge dropoff after elite tier
  K: 12,   // Replaceable, but top kickers matter
  DEF: 12, // Streaming viable, but elite defenses help
};

export const MIN_SCARCITY = 1;
export const MAX_SCARCITY = 10;

/** Higher score = fewer elite players left at the position. */
export function calculatePositionalScarcity(
  position: Position,
  availablePlayers: readonly Player[]
): number {
  const cutoff = ELITE_POSITIONAL_RANK_CUTOFFS[position];

  const eliteAvailable = availablePlayers.filter(
    (p) => p.position === position && p.positionalRank <= cutoff
  ).length;

  const scarcity = MAX_SCARCITY - (eliteAvailable / cutoff) * MAX_SCARCITY;

  return Math.max(MIN_SCARCITY, Math.min(MAX_SCARCITY, scarcity));
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
