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

export const NEWS_STATUSES = [
  'healthy',
  'limited',
  'questionable',
  'out',
  'unknown',
] as const;

export type NewsStatus = (typeof NEWS_STATUSES)[number];

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
  /** Generic market/platform rank snapshot */
  readonly marketRank: number;
  /** Generic market ADP snapshot */
  readonly marketAdp: number;
  /** Positive means player is rising up the market */
  readonly marketAdpTrend: number;

  /** Player is in final year of contract */
  readonly isContractYear: boolean;
  /** Year contract expires (if known) */
  readonly contractEndYear?: number;
  /** Team offensive environment score (1-10 scale) */
  readonly offensiveEnvironmentScore: number;
  /** Derived projection proxy until external projection source is added */
  readonly projectedPoints: number;
  /** Derived value-over-replacement style score */
  readonly valueOverReplacement: number;
  /** Position-specific draft tier */
  readonly tier: number;
  /** Size of the dropoff after this player within the position */
  readonly tierDropoffScore: number;
  /** Heuristic probability that player survives to a later pick window */
  readonly nextPickSurvivalProbability: number;
  /** Ceiling-oriented score */
  readonly ceilingScore: number;
  /** Floor-oriented score */
  readonly floorScore: number;
  /** Upside-oriented score */
  readonly upsideScore: number;
  /** Higher means more fragility/risk */
  readonly injuryRiskScore: number;
  /** Current availability/news signal */
  readonly newsStatus: NewsStatus;
  /** Simple same-team stack partners for QB/WR/TE-style correlations */
  readonly stackPartnerTeam: NFLTeam;

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

export function isNewsStatus(value: unknown): value is NewsStatus {
  return typeof value === 'string' && NEWS_STATUSES.includes(value as NewsStatus);
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
    typeof candidate['marketRank'] === 'number' &&
    typeof candidate['marketAdp'] === 'number' &&
    typeof candidate['marketAdpTrend'] === 'number' &&
    typeof candidate['isContractYear'] === 'boolean' &&
    typeof candidate['offensiveEnvironmentScore'] === 'number' &&
    typeof candidate['projectedPoints'] === 'number' &&
    typeof candidate['valueOverReplacement'] === 'number' &&
    typeof candidate['tier'] === 'number' &&
    typeof candidate['tierDropoffScore'] === 'number' &&
    typeof candidate['nextPickSurvivalProbability'] === 'number' &&
    typeof candidate['ceilingScore'] === 'number' &&
    typeof candidate['floorScore'] === 'number' &&
    typeof candidate['upsideScore'] === 'number' &&
    typeof candidate['injuryRiskScore'] === 'number' &&
    isNewsStatus(candidate['newsStatus']) &&
    isNFLTeam(candidate['stackPartnerTeam']) &&
    isHighlightLevel(candidate['highlightLevel'])
  );
}
