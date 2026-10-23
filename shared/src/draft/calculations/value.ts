/** Market ADP minus expert rank. Positive values mean the player costs less than their rank. */
export function calculateValueScore(
  ecrRank: number,
  sleeperAdp: number
): number {
  return sleeperAdp - ecrRank;
}
