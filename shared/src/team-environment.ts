export type { TeamEnvironment, VolumeLevel } from './catalog/decoders.js';
import type { TeamEnvironment } from './catalog/decoders.js';

export function isTopOffense(environment: TeamEnvironment): boolean {
  return environment.offenseScore >= 8;
}

export function isDecentOffense(environment: TeamEnvironment): boolean {
  return environment.offenseScore >= 6;
}
