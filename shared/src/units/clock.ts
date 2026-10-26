/** The time source. Domain code takes a Clock or a `now` value instead of reading Date itself. */
export interface Clock {
  readonly now: () => number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A clock stopped at `time`, for tests and deterministic fixtures. */
export function fixedClock(time: number): Clock {
  return { now: () => time };
}
