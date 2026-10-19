export type { TeamEnvironment, VolumeLevel } from './catalog/decoders.js';
import type { TeamEnvironment } from './catalog/decoders.js';
export { isTeamEnvironment } from './catalog/decoders.js';

/**
 * Checks if a team has a top-tier offense (score >= 8)
 */
export function isTopOffense(environment: TeamEnvironment): boolean {
  return environment.offenseScore >= 8;
}

/**
 * Checks if a team has a decent offense (score >= 6)
 */
export function isDecentOffense(environment: TeamEnvironment): boolean {
  return environment.offenseScore >= 6;
}
