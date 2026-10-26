/**
 * Numeric units. Each brand is a plain number at runtime, but TypeScript rejects passing one
 * unit where another is expected, and rejects an unbranded number where a unit is expected.
 * Values enter a unit through the constructors below where external data becomes domain
 * data; arithmetic on a unit yields a plain number until it is branded again.
 */
declare const unit: unique symbol;
type Unit<Name extends string> = number & { readonly [unit]: Name };

/** A chance from 0 to 1. */
export type Probability = Unit<'probability'>;
/** A share from 0 to 100. */
export type Percent = Unit<'percent'>;
/** A 1-based ordinal position, where 1 is best. */
export type Rank = Unit<'rank'>;
/** Value over replacement in league-scored points; negative means below replacement. */
export type Vor = Unit<'vor'>;

/* The constructors do not check ranges. Callers own the unit claim, as the decoders own the shape. */
export function asProbability(value: number): Probability {
  return value as Probability;
}

export function asPercent(value: number): Percent {
  return value as Percent;
}

export function asRank(value: number): Rank {
  return value as Rank;
}

export function asVor(value: number): Vor {
  return value as Vor;
}

/** The probability as a whole-number percent, as the interface shows it. */
export function toWholePercent(value: Probability): Percent {
  return asPercent(Math.round(value * 100));
}
