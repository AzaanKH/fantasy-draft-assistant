/** Resource bounds for supported fantasy leagues, applied before allocating client state. */
export const MAX_DRAFT_TEAMS = 32;
export const MAX_DRAFT_ROUNDS = 40;
export const MAX_DRAFT_PICKS = MAX_DRAFT_TEAMS * MAX_DRAFT_ROUNDS;
export const MAX_ROSTER_SPOTS = 40;

export function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function isDraftSize(teams: unknown, rounds: unknown): boolean {
  return isBoundedInteger(teams, 2, MAX_DRAFT_TEAMS) && isBoundedInteger(rounds, 1, MAX_DRAFT_ROUNDS);
}
