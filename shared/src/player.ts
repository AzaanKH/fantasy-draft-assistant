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

export const PREDICTION_SOURCES = ['model', 'fantasypros', 'heuristic'] as const;

export type PredictionSource = (typeof PREDICTION_SOURCES)[number];

export const TIER_SOURCES = ['league-projection', 'ecr-fallback'] as const;

export type TierSource = (typeof TIER_SOURCES)[number];

export const SURVIVAL_MODEL_SOURCES = ['league-history', 'heuristic'] as const;

export type SurvivalModelSource = (typeof SURVIVAL_MODEL_SOURCES)[number];

export interface PlayerPrediction {
  readonly playerId?: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  /** Base PPR projection before league-specific bonuses */
  readonly baseProjectedPoints?: number;
  /** Leakage-safe position-specific opportunity and efficiency residual */
  readonly usageEfficiencyAdjustment?: number;
  /** Rush-attempt and TE-premium points added for this league */
  readonly customScoringAdjustment?: number;
  readonly projectedPoints: number;
  /** Projection after league-specific bonuses */
  readonly customProjectedPoints?: number;
  /** Low outcome from the model's league-scored point distribution */
  readonly floorProjectedPoints?: number;
  /** High outcome from the model's league-scored point distribution */
  readonly ceilingProjectedPoints?: number;
  /** Percentile of projected points within the player's position (0-100) */
  readonly positionPercentile?: number;
  readonly valueOverReplacement?: number;
  readonly ceilingScore?: number;
  readonly floorScore?: number;
  readonly uncertaintyScore?: number;
  readonly riskScore?: number;
  readonly injuryRiskScore?: number;
  readonly source: PredictionSource;
  /** Position model that produced the common prediction outputs */
  readonly modelFamily?: string;
  readonly modelVersion?: string;
}

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
  /** FantasyPros rank within the player's position */
  readonly positionalRank: number;
  /** Sleeper search_rank platform-ordering proxy; not observed draft ADP */
  readonly sleeperAdp: number;
  /** Explicit alias for Sleeper's search-ordering signal. */
  readonly sleeperSearchRank?: number;
  /** Observed-draft ADP from FFC, with FantasyPros/Sleeper fallbacks. */
  readonly consensusAdp?: number;
  /** Consensus ADP - ECR (positive = expert value versus observed market cost) */
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
  /** Difference from the published full-PPR projection after local league scoring. */
  readonly leagueScoringAdjustment?: number;
  /** Projection before the confidence-weighted sportsbook market overlay. */
  readonly preMarketProjectedPoints?: number;
  /** Fantasy-point delta contributed by sportsbook stat markets. */
  readonly marketAdjustment?: number;
  /** Average confidence across usable sportsbook stat markets (0-1). */
  readonly marketConfidence?: number;
  /** Number of stat markets included in the sportsbook overlay. */
  readonly sportsbookMarketCount?: number;
  /** Derived value-over-replacement style score */
  readonly valueOverReplacement: number;
  /** League-adjusted, position-specific draft tier. */
  readonly tier: number;
  /** Published FantasyPros tier when supplied by the rankings snapshot. */
  readonly fantasyProsTier?: number;
  /** Signal family used to generate the displayed draft tier. */
  readonly tierSource?: TierSource;
  /** Normalized strength (0-1) of the projection drop after this player. */
  readonly tierDropoffScore: number;
  /** League-scored projected-point drop to the next player at this position. */
  readonly tierDropoffPoints?: number;
  /** Estimated chance that the player remains available at the manager's next selection. */
  readonly nextPickSurvivalProbability: number;
  /** Overall pick number for the manager's next selection. */
  readonly nextPickNumber?: number;
  /** Round.pick label for the manager's next selection. */
  readonly nextPickLabel?: string;
  /** Number of selections from the live cursor through the next manager selection. */
  readonly picksUntilNextPick?: number;
  /** League-adjusted expected draft cost after applying historical room tendencies */
  readonly leagueAdjustedMarketRank?: number;
  /** Negative means this league tends to take this profile earlier than the Sleeper proxy */
  readonly leagueMarketDelta?: number;
  /** Short explanation of the league-history tendency applied to this player */
  readonly leaguePositionTendency?: string;
  /** Source used for next-pick survival probability */
  readonly survivalModelSource?: SurvivalModelSource;
  /** Pick estimate contributed by the Primary League's empirical position history. */
  readonly historicalExpectedPick?: number;
  /** Current observed-market ADP used to calibrate the historical estimate. */
  readonly consensusMarketPick?: number;
  /** Sleeper search rank used only as a secondary timing input. */
  readonly sleeperTimingPick?: number;
  /** Primary League pick sample behind the historical estimate. */
  readonly survivalModelSampleSize?: number;
  /** Ceiling-oriented score */
  readonly ceilingScore: number;
  /** Floor-oriented score */
  readonly floorScore: number;
  /** Upside-oriented score */
  readonly upsideScore: number;
  /** Higher means wider projection range / lower confidence */
  readonly uncertaintyScore: number;
  /** Higher means more fragility/risk */
  readonly injuryRiskScore: number;
  /** Source that supplied the prediction layer fields */
  readonly predictionSource: PredictionSource;
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

export function isPredictionSource(value: unknown): value is PredictionSource {
  return typeof value === 'string' && PREDICTION_SOURCES.includes(value as PredictionSource);
}

export function isTierSource(value: unknown): value is TierSource {
  return typeof value === 'string' && TIER_SOURCES.includes(value as TierSource);
}

export function isNewsStatus(value: unknown): value is NewsStatus {
  return typeof value === 'string' && NEWS_STATUSES.includes(value as NewsStatus);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number';
}

function isSurvivalModelSource(value: unknown): value is Player['survivalModelSource'] {
  return value === undefined || SURVIVAL_MODEL_SOURCES.includes(value as SurvivalModelSource);
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
    typeof candidate['positionalRank'] === 'number' &&
    typeof candidate['sleeperAdp'] === 'number' &&
    isOptionalNumber(candidate['sleeperSearchRank']) &&
    isOptionalNumber(candidate['consensusAdp']) &&
    typeof candidate['valueScore'] === 'number' &&
    typeof candidate['marketRank'] === 'number' &&
    typeof candidate['marketAdp'] === 'number' &&
    typeof candidate['marketAdpTrend'] === 'number' &&
    typeof candidate['isContractYear'] === 'boolean' &&
    typeof candidate['offensiveEnvironmentScore'] === 'number' &&
    typeof candidate['projectedPoints'] === 'number' &&
    isOptionalNumber(candidate['leagueScoringAdjustment']) &&
    isOptionalNumber(candidate['preMarketProjectedPoints']) &&
    isOptionalNumber(candidate['marketAdjustment']) &&
    isOptionalNumber(candidate['marketConfidence']) &&
    isOptionalNumber(candidate['sportsbookMarketCount']) &&
    typeof candidate['valueOverReplacement'] === 'number' &&
    typeof candidate['tier'] === 'number' &&
    isOptionalNumber(candidate['fantasyProsTier']) &&
    (candidate['tierSource'] === undefined || isTierSource(candidate['tierSource'])) &&
    typeof candidate['tierDropoffScore'] === 'number' &&
    isOptionalNumber(candidate['tierDropoffPoints']) &&
    typeof candidate['nextPickSurvivalProbability'] === 'number' &&
    isOptionalNumber(candidate['nextPickNumber']) &&
    (candidate['nextPickLabel'] === undefined || typeof candidate['nextPickLabel'] === 'string') &&
    isOptionalNumber(candidate['picksUntilNextPick']) &&
    isOptionalNumber(candidate['leagueAdjustedMarketRank']) &&
    isOptionalNumber(candidate['leagueMarketDelta']) &&
    (candidate['leaguePositionTendency'] === undefined ||
      typeof candidate['leaguePositionTendency'] === 'string') &&
    isSurvivalModelSource(candidate['survivalModelSource']) &&
    isOptionalNumber(candidate['historicalExpectedPick']) &&
    isOptionalNumber(candidate['consensusMarketPick']) &&
    isOptionalNumber(candidate['sleeperTimingPick']) &&
    isOptionalNumber(candidate['survivalModelSampleSize']) &&
    typeof candidate['ceilingScore'] === 'number' &&
    typeof candidate['floorScore'] === 'number' &&
    typeof candidate['upsideScore'] === 'number' &&
    typeof candidate['uncertaintyScore'] === 'number' &&
    typeof candidate['injuryRiskScore'] === 'number' &&
    isPredictionSource(candidate['predictionSource']) &&
    isNewsStatus(candidate['newsStatus']) &&
    isNFLTeam(candidate['stackPartnerTeam']) &&
    isHighlightLevel(candidate['highlightLevel'])
  );
}
