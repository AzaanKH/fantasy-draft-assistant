/** Short reception-scoring label for league summaries: Standard, Half-PPR, PPR, or the exact value. */
export function receptionScoringLabel(pointsPerReception: number): string {
  if (pointsPerReception === 0) return 'Standard';
  if (pointsPerReception === 0.5) return 'Half-PPR';
  if (pointsPerReception === 1) return 'PPR';
  return `${String(pointsPerReception)} PPR`;
}
