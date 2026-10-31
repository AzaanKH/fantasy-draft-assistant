import type { Probability, Rank, Vor } from './units/brands.js';
import { isPosition, type Position } from './league/positions.js';

export const NFL_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
] as const;

export type NFLTeam = (typeof NFL_TEAMS)[number];

export { POSITIONS, isPosition, type Position } from './league/positions.js';

export const NEWS_STATUSES = [
  'healthy',
  'limited',
  'questionable',
  'out',
  'unknown',
] as const;

export type NewsStatus = (typeof NEWS_STATUSES)[number];

/** Thresholds live in determineHighlightLevel. */
const HIGHLIGHT_LEVELS = ['strong-buy', 'good-value', 'neutral', 'avoid'] as const;

export type HighlightLevel = (typeof HIGHLIGHT_LEVELS)[number];

export const PREDICTION_SOURCES = ['model', 'fantasypros', 'heuristic'] as const;

export type PredictionSource = (typeof PREDICTION_SOURCES)[number];

const TIER_SOURCES = ['league-projection', 'ecr-fallback'] as const;

export type TierSource = (typeof TIER_SOURCES)[number];

const SURVIVAL_MODEL_SOURCES = ['league-history', 'heuristic'] as const;

export type SurvivalModelSource = (typeof SURVIVAL_MODEL_SOURCES)[number];

export type { PlayerPrediction } from './catalog/decoders.js';

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly byeWeek: number;

  /** FantasyPros Expert Consensus Ranking */
  readonly ecrRank: Rank;
  /** FantasyPros rank within the player's position */
  readonly positionalRank: Rank;
  /** Sleeper search_rank platform-ordering proxy; not observed draft ADP */
  readonly sleeperAdp: number;
  /** Explicit alias for Sleeper's search-ordering signal. */
  readonly sleeperSearchRank?: number;
  /** Observed-draft ADP from FFC, with FantasyPros/Sleeper fallbacks. */
  readonly consensusAdp?: number;
  /** Consensus ADP - ECR (positive = expert value versus observed market cost) */
  readonly valueScore: number;
  readonly marketRank: number;
  readonly marketAdp: number;
  /** Positive means player is rising up the market */
  readonly marketAdpTrend: number;

  readonly isContractYear: boolean;
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
  readonly marketConfidence?: Probability;
  /** Number of stat markets included in the sportsbook overlay. */
  readonly sportsbookMarketCount?: number;
  /** Derived value-over-replacement style score */
  readonly valueOverReplacement: Vor;
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
  readonly nextPickSurvivalProbability: Probability;
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
  readonly ceilingScore: number;
  readonly floorScore: number;
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

  readonly highlightLevel: HighlightLevel;
  /** Custom projected points based on league scoring */
  readonly customProjectedPoints?: number;
}

export function isNFLTeam(value: unknown): value is NFLTeam {
  return typeof value === 'string' && NFL_TEAMS.some(item => item === value);
}

function isHighlightLevel(value: unknown): value is HighlightLevel {
  return typeof value === 'string' && HIGHLIGHT_LEVELS.some(item => item === value);
}

export function isPredictionSource(value: unknown): value is PredictionSource {
  return typeof value === 'string' && PREDICTION_SOURCES.some(item => item === value);
}

function isTierSource(value: unknown): value is TierSource {
  return typeof value === 'string' && TIER_SOURCES.some(item => item === value);
}

export function isNewsStatus(value: unknown): value is NewsStatus {
  return typeof value === 'string' && NEWS_STATUSES.some(item => item === value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number';
}

function isSurvivalModelSource(value: unknown): value is Player['survivalModelSource'] {
  return value === undefined || SURVIVAL_MODEL_SOURCES.some(item => item === value);
}

export function isPlayer(obj: unknown): obj is Player {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
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
