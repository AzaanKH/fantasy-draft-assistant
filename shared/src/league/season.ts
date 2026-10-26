import { systemClock, type Clock } from '../units/clock.js';

/** January and February belong to the prior NFL season. The season changes on March 1 UTC. */
export function currentSeason(clock: Clock = systemClock): number {
  const time = new Date(clock.now());
  const year = time.getUTCFullYear();
  return time.getUTCMonth() < 2 ? year - 1 : year;
}
