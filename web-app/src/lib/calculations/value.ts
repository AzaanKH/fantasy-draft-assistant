/**
 * Value score calculation
 *
 * Calculates the difference between ECR rank and Sleeper ADP
 * to identify undervalued or overvalued players.
 */

/**
 * Calculate value score: ECR rank - Sleeper ADP
 *
 * @param ecrRank - Expert Consensus Ranking (lower = better)
 * @param sleeperAdp - Sleeper Average Draft Position (lower = drafted earlier)
 * @returns Positive = undervalued on Sleeper (good), Negative = overvalued (bad)
 *
 * @example
 * // Player ranked #15 by experts but ADP is #25 on Sleeper
 * calculateValueScore(15, 25) // Returns 10 (undervalued - good pick)
 *
 * @example
 * // Player ranked #30 by experts but ADP is #15 on Sleeper
 * calculateValueScore(30, 15) // Returns -15 (overvalued - avoid)
 */
export function calculateValueScore(
  ecrRank: number,
  sleeperAdp: number
): number {
  return sleeperAdp - ecrRank;
}
