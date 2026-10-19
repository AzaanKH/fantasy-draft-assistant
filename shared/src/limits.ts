import { Schema } from 'effect';

/** Resource bounds for supported fantasy leagues, applied before allocating client state. */
export const MAX_DRAFT_TEAMS = 32;
export const MAX_DRAFT_ROUNDS = 40;
export const MAX_DRAFT_PICKS = MAX_DRAFT_TEAMS * MAX_DRAFT_ROUNDS;
export const MAX_ROSTER_SPOTS = 40;

const boundedIntegerArguments = /* @__PURE__ */ Schema.Tuple([Schema.Int, Schema.Number, Schema.Number])
  .check(/* @__PURE__ */ Schema.makeFilter(([value, minimum, maximum]) => value >= minimum && value <= maximum));
const boundedIntegerPredicate = /* @__PURE__ */ Schema.is(boundedIntegerArguments);

export function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return boundedIntegerPredicate([value, minimum, maximum]);
}

export function isDraftSize(teams: unknown, rounds: unknown): boolean {
  return isBoundedInteger(teams, 2, MAX_DRAFT_TEAMS) && isBoundedInteger(rounds, 1, MAX_DRAFT_ROUNDS);
}
