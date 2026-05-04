/**
 * NFL team abbreviations
 */
export const NFL_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
] as const;

export type NFLTeam = (typeof NFL_TEAMS)[number];

/**
 * Fantasy football positions
 */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

export type Position = (typeof POSITIONS)[number];

/**
 * Highlight levels for player recommendations
 * - strong-buy: Value >= +10 AND (contract year OR top-10 offense)
 * - good-value: Value >= +5 OR contract year with decent offense
 * - neutral: Default state
 * - avoid: Value <= -15 (significantly overvalued)
 */
export const HIGHLIGHT_LEVELS = ['strong-buy', 'good-value', 'neutral', 'avoid'] as const;

export type HighlightLevel = (typeof HIGHLIGHT_LEVELS)[number];

/**
 * Core player interface with all ranking and metadata fields
 */
export interface Player {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly byeWeek: number;

  /** FantasyPros Expert Consensus Ranking */
  readonly ecrRank: number;
  /** Sleeper platform ADP */
  readonly sleeperAdp: number;
  /** ECR - ADP (positive = undervalued on Sleeper) */
  readonly valueScore: number;

  /** Player is in final year of contract */
  readonly isContractYear: boolean;
  /** Year contract expires (if known) */
  readonly contractEndYear?: number;
  /** Team offensive environment score (1-10 scale) */
  readonly offensiveEnvironmentScore: number;

  /** Calculated highlight level for UI */
  readonly highlightLevel: HighlightLevel;
  /** Custom projected points based on league scoring */
  readonly customProjectedPoints?: number;
}

/**
 * Type guard to check if a value is a valid Position
 */
export function isPosition(value: unknown): value is Position {
  return typeof value === 'string' && POSITIONS.includes(value as Position);
}

/**
 * Type guard to check if a value is a valid NFLTeam
 */
export function isNFLTeam(value: unknown): value is NFLTeam {
  return typeof value === 'string' && NFL_TEAMS.includes(value as NFLTeam);
}

/**
 * Type guard to check if a value is a valid HighlightLevel
 */
export function isHighlightLevel(value: unknown): value is HighlightLevel {
  return typeof value === 'string' && HIGHLIGHT_LEVELS.includes(value as HighlightLevel);
}

/**
 * Type guard to validate Player object structure
 */
export function isPlayer(obj: unknown): obj is Player {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    isPosition(candidate['position']) &&
    isNFLTeam(candidate['team']) &&
    typeof candidate['byeWeek'] === 'number' &&
    typeof candidate['ecrRank'] === 'number' &&
    typeof candidate['sleeperAdp'] === 'number' &&
    typeof candidate['valueScore'] === 'number' &&
    typeof candidate['isContractYear'] === 'boolean' &&
    typeof candidate['offensiveEnvironmentScore'] === 'number' &&
    isHighlightLevel(candidate['highlightLevel'])
  );
}
