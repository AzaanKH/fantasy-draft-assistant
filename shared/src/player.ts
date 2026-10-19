import { Schema } from 'effect';

/**
 * NFL team abbreviations
 */
export const NFL_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
] as const;

const nflTeamSchema = /* @__PURE__ */ Schema.Literals(NFL_TEAMS);

export type NFLTeam = typeof nflTeamSchema.Type;

/**
 * Fantasy football positions
 */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

const positionSchema = /* @__PURE__ */ Schema.Literals(POSITIONS);

export type Position = typeof positionSchema.Type;

export const NEWS_STATUSES = [
  'healthy',
  'limited',
  'questionable',
  'out',
  'unknown',
] as const;

const newsStatusSchema = /* @__PURE__ */ Schema.Literals(NEWS_STATUSES);

export type NewsStatus = typeof newsStatusSchema.Type;

/**
 * Highlight levels for player recommendations
 * - strong-buy: Value >= +10 AND (contract year OR top-10 offense)
 * - good-value: Value >= +5 OR contract year with decent offense
 * - neutral: Default state
 * - avoid: Value <= -15 (significantly overvalued)
 */
const HIGHLIGHT_LEVELS = ['strong-buy', 'good-value', 'neutral', 'avoid'] as const;

const highlightLevelSchema = /* @__PURE__ */ Schema.Literals(HIGHLIGHT_LEVELS);

export type HighlightLevel = typeof highlightLevelSchema.Type;

export const PREDICTION_SOURCES = ['model', 'fantasypros', 'heuristic'] as const;

const predictionSourceSchema = /* @__PURE__ */ Schema.Literals(PREDICTION_SOURCES);

export type PredictionSource = typeof predictionSourceSchema.Type;

const TIER_SOURCES = ['league-projection', 'ecr-fallback'] as const;

const tierSourceSchema = /* @__PURE__ */ Schema.Literals(TIER_SOURCES);

export type TierSource = typeof tierSourceSchema.Type;

const SURVIVAL_MODEL_SOURCES = ['league-history', 'heuristic'] as const;

const survivalModelSourceSchema = /* @__PURE__ */ Schema.Literals(SURVIVAL_MODEL_SOURCES);

export type SurvivalModelSource = typeof survivalModelSourceSchema.Type;

export type { PlayerPrediction } from './catalog/decoders.js';

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

const positionPredicate = /* @__PURE__ */ Schema.is(positionSchema);
const nflTeamPredicate = /* @__PURE__ */ Schema.is(nflTeamSchema);
const predictionSourcePredicate = /* @__PURE__ */ Schema.is(predictionSourceSchema);
const newsStatusPredicate = /* @__PURE__ */ Schema.is(newsStatusSchema);

export function isPosition(value: unknown): value is Position {
  return positionPredicate(value);
}

export function isNFLTeam(value: unknown): value is NFLTeam {
  return nflTeamPredicate(value);
}

export function isPredictionSource(value: unknown): value is PredictionSource {
  return predictionSourcePredicate(value);
}

export function isNewsStatus(value: unknown): value is NewsStatus {
  return newsStatusPredicate(value);
}

const optionalNumber = /* @__PURE__ */ Schema.optional(Schema.Number);
const playerSchema = /* @__PURE__ */ Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  position: positionSchema,
  team: nflTeamSchema,
  byeWeek: Schema.Number,
  ecrRank: Schema.Number,
  positionalRank: Schema.Number,
  sleeperAdp: Schema.Number,
  sleeperSearchRank: optionalNumber,
  consensusAdp: optionalNumber,
  valueScore: Schema.Number,
  marketRank: Schema.Number,
  marketAdp: Schema.Number,
  marketAdpTrend: Schema.Number,
  isContractYear: Schema.Boolean,
  offensiveEnvironmentScore: Schema.Number,
  projectedPoints: Schema.Number,
  leagueScoringAdjustment: optionalNumber,
  preMarketProjectedPoints: optionalNumber,
  marketAdjustment: optionalNumber,
  marketConfidence: optionalNumber,
  sportsbookMarketCount: optionalNumber,
  valueOverReplacement: Schema.Number,
  tier: Schema.Number,
  fantasyProsTier: optionalNumber,
  tierSource: /* @__PURE__ */ Schema.optional(tierSourceSchema),
  tierDropoffScore: Schema.Number,
  tierDropoffPoints: optionalNumber,
  nextPickSurvivalProbability: Schema.Number,
  nextPickNumber: optionalNumber,
  nextPickLabel: /* @__PURE__ */ Schema.optional(Schema.String),
  picksUntilNextPick: optionalNumber,
  leagueAdjustedMarketRank: optionalNumber,
  leagueMarketDelta: optionalNumber,
  leaguePositionTendency: /* @__PURE__ */ Schema.optional(Schema.String),
  survivalModelSource: /* @__PURE__ */ Schema.optional(survivalModelSourceSchema),
  historicalExpectedPick: optionalNumber,
  consensusMarketPick: optionalNumber,
  sleeperTimingPick: optionalNumber,
  survivalModelSampleSize: optionalNumber,
  ceilingScore: Schema.Number,
  floorScore: Schema.Number,
  upsideScore: Schema.Number,
  uncertaintyScore: Schema.Number,
  injuryRiskScore: Schema.Number,
  predictionSource: predictionSourceSchema,
  newsStatus: newsStatusSchema,
  stackPartnerTeam: nflTeamSchema,
  highlightLevel: highlightLevelSchema,
});
const playerPredicate = /* @__PURE__ */ Schema.is(playerSchema);

export function isPlayer(obj: unknown): obj is Player {
  return playerPredicate(obj);
}
