import type { NFLTeam } from './player';

/**
 * Volume classification for pass/rush attempts
 */
export const VOLUME_LEVELS = ['high', 'medium', 'low'] as const;

export type VolumeLevel = (typeof VOLUME_LEVELS)[number];

/**
 * Team offensive environment assessment
 * Used to evaluate player situations and upside
 */
export interface TeamEnvironment {
  readonly team: NFLTeam;
  readonly name: string;
  /** Composite offensive score (1-10 scale) */
  readonly offenseScore: number;
  /** Pass volume classification */
  readonly passVolume: VolumeLevel;
  /** Rush volume classification */
  readonly rushVolume: VolumeLevel;
  /** Points scored rank (1-32, 1 = most points) */
  readonly pointsRank: number;
  /** Pass attempts rank (1-32, 1 = most attempts) */
  readonly passAttemptsRank: number;
  /** Rush attempts rank (1-32, 1 = most attempts) */
  readonly rushAttemptsRank: number;
  /** Whether coaching staff is stable year-over-year */
  readonly coachingStability: boolean;
}

/**
 * Type guard to check if a value is a valid VolumeLevel
 */
export function isVolumeLevel(value: unknown): value is VolumeLevel {
  return typeof value === 'string' && VOLUME_LEVELS.includes(value as VolumeLevel);
}

/**
 * Type guard to validate TeamEnvironment object structure
 */
export function isTeamEnvironment(obj: unknown): obj is TeamEnvironment {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate['team'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['offenseScore'] === 'number' &&
    isVolumeLevel(candidate['passVolume']) &&
    isVolumeLevel(candidate['rushVolume']) &&
    typeof candidate['pointsRank'] === 'number' &&
    typeof candidate['passAttemptsRank'] === 'number' &&
    typeof candidate['rushAttemptsRank'] === 'number' &&
    typeof candidate['coachingStability'] === 'boolean'
  );
}

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
