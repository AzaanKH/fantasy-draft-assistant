/**
 * The one source for fantasy positions and position groups. Production code outside
 * shared/src/league names these constants instead of repeating position arrays; the
 * agent/no-position-array lint rule enforces that.
 */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

export type Position = (typeof POSITIONS)[number];

export const OFFENSIVE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const satisfies readonly Position[];

export type OffensivePosition = (typeof OFFENSIVE_POSITIONS)[number];

/** Kicker and defense: drafted late and never FLEX-eligible. */
export const KICKER_DEFENSE_POSITIONS = ['K', 'DEF'] as const satisfies readonly Position[];

/**
 * FLEX eligibility groups a league can configure. The league's roster requirements carry
 * the chosen group; code reads it from there rather than assuming the standard group.
 */
export const FLEX_GROUPS = {
  standard: ['RB', 'WR', 'TE'],
  receiving: ['WR', 'TE'],
  superflex: OFFENSIVE_POSITIONS,
} as const satisfies Readonly<Record<string, readonly Position[]>>;

export function isPosition(value: unknown): value is Position {
  return typeof value === 'string' && POSITIONS.some(item => item === value);
}

/** A SQL `in` list, such as `('QB', 'RB', 'WR', 'TE')`, generated from position constants. */
export function sqlPositionList(positions: readonly Position[]): string {
  return `(${positions.map((position) => `'${position}'`).join(', ')})`;
}

interface FlexEligibility {
  readonly FLEX: { readonly eligiblePositions: readonly Position[] };
}

/** Whether the league's FLEX slots accept this position. Superflex leagues accept QBs. */
export function isFlexEligible(requirements: FlexEligibility, position: Position): boolean {
  return requirements.FLEX.eligiblePositions.includes(position);
}
