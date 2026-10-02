// Player types
export { MAX_DRAFT_TEAMS, MAX_DRAFT_ROUNDS, MAX_DRAFT_PICKS, MAX_ROSTER_SPOTS, isBoundedInteger, isDraftSize } from './limits.js';
export {
  NFL_TEAMS,
  POSITIONS,
  NEWS_STATUSES,
  HIGHLIGHT_LEVELS,
  PREDICTION_SOURCES,
  TIER_SOURCES,
  SURVIVAL_MODEL_SOURCES,
  isPosition,
  isNFLTeam,
  isHighlightLevel,
  isPredictionSource,
  isTierSource,
  isNewsStatus,
  isPlayer,
} from './player.js';

export type {
  NFLTeam,
  Position,
  NewsStatus,
  HighlightLevel,
  PredictionSource,
  TierSource,
  SurvivalModelSource,
  PlayerPrediction,
  Player,
} from './player.js';

// Draft types
export {
  NEED_PRIORITIES,
  DEFAULT_ROSTER_REQUIREMENTS,
  createEmptyRoster,
  isNeedPriority,
  DECISION_LENSES,
  DECISION_DIVERGENCE_FACTORS,
} from './draft.js';

export type {
  Roster,
  PositionRequirement,
  FlexRequirement,
  RosterRequirements,
  DraftPick,
  NeedPriority,
  PositionNeed,
  RecommendationDecisionFactors,
  ExpectedNextPickAlternative,
  Recommendation,
  DecisionLens,
  DecisionDivergenceFactor,
  DecisionOutput,
} from './draft.js';

// Team environment types
export {
  VOLUME_LEVELS,
  isVolumeLevel,
  isTeamEnvironment,
  isTopOffense,
  isDecentOffense,
} from './team-environment.js';

export type {
  VolumeLevel,
  TeamEnvironment,
} from './team-environment.js';

// Scoring types
export { DEFAULT_SCORING_RULES } from './scoring.js';

export type {
  PassingScoringRules,
  RushingScoringRules,
  ReceivingScoringRules,
  KickingScoringRules,
  PointsAllowedTiers,
  DefenseScoringRules,
  MiscScoringRules,
  ScoringRules,
} from './scoring.js';

// Normalized league scoring and roster configuration
export {
  createDefaultLeagueSettings,
  createLeagueSettings,
  isLeagueSettings,
  isSleeperLeague,
  normalizeSleeperLeagueSettings,
} from './league-settings.js';

export type {
  LeagueSettings,
  LeagueSettingsInput,
  LeagueSettingsSource,
  SleeperLeague,
} from './league-settings.js';

// Observed market ADP
export { isMarketAdpFormat, isMarketAdpSnapshot } from './market-adp.js';

export type {
  MarketAdpFormat,
  MarketAdpPlayer,
  MarketAdpSnapshot,
} from './market-adp.js';

// Scraper types
export {
  getTeamByeWeeks,
  parsePlayerNameAndTeam,
  parsePositionString,
} from './scrapers.js';

export type {
  ECRPlayer,
  ContractPlayer,
  RawECRData,
} from './scrapers.js';

// FantasyPros snapshot types
export {
  FANTASYPROS_SNAPSHOT_SOURCES,
  isFantasyProsSnapshotSource,
} from './fantasypros.js';

export type {
  FantasyProsSnapshotSource,
  FantasyProsProjection,
  FantasyProsAdpPlayer,
  FantasyProsNewsItem,
  FantasyProsSnapshotMetadata,
  FantasyProsSnapshot,
} from './fantasypros.js';

// Sync types
export { isDraftSessionSummary } from './sessions.js';
export type { DraftSessionSummary } from './sessions.js';
export {
  DraftSyncEngine,
  isDraftProvider,
  normalizePosition,
  isDraftMetadata,
  isEspnDraftSnapshot,
  isDraftSyncSnapshot,
  isDraftSyncUpdate,
  isSleeperDraftMetadata,
  isSleeperDraftPick,
  isSleeperDraftPickList,
  normalizeSleeperDraftMetadata,
  normalizeSleeperPick,
  resolveSleeperDraftLeagueId,
} from './sync.js';

export type {
  SleeperDraftPick,
  SleeperDraftMetadata,
  DraftProvider,
  DraftStatus,
  DraftType,
  DraftMetadata,
  DraftSyncSource,
  DraftPickConfidence,
  DraftPickEvent,
  EspnDraftSnapshot,
  DraftSyncState,
  DraftSyncSnapshot,
  DraftSyncUpdate,
} from './sync.js';

// Experimental model shadow-evaluation types
export { isShadowRecommendationEvent } from './shadow.js';

export type {
  ShadowRecommendation,
  ShadowPositionNeed,
  ShadowRecommendationEvent,
} from './shadow.js';

// ECR-anchored pick expected-value scoring
export {
  DEFAULT_PICK_EV_LAYERS,
  PICK_EV_ECR_GUARDRAIL,
  PICK_EV_OVERRIDE_THRESHOLD,
  optimizeLineupUtility,
  scorePickEvBoard,
  selectPickEvRecommendation,
} from './pick-ev.js';

export type {
  PickEvPlayer,
  PickEvRosterPlayer,
  PickEvNeed,
  PickEvContext,
  PickEvLayers,
  PickEvScore,
  PickEvSelection,
} from './pick-ev.js';

// Sportsbook market snapshots and projection adjustments
export {
  SPORTSBOOKS,
  SPORTSBOOK_MARKETS,
  americanOddsToImpliedProbability,
  calculateSportsbookProjectionAdjustment,
  getLeagueScoringValue,
  isSportsbookSnapshot,
  normalizeSportsbookPlayerName,
} from './sportsbook.js';

export type {
  Sportsbook,
  SportsbookMarket,
  SportsbookOverUnderLine,
  SportsbookMilestoneLine,
  SportsbookSnapshotMetadata,
  SportsbookSnapshot,
  FantasyProsMarketStats,
  SportsbookMarketConsensus,
  SportsbookProjectionAdjustment,
} from './sportsbook.js';

// Product Draft Readiness: Core Draft Data blocks; Optional Signals degrade.
export {
  CORE_DRAFT_DATA_KEYS,
  OPTIONAL_SIGNAL_KEYS,
  DRAFT_READINESS_DEFINITIONS,
  evaluateDraftReadiness,
  formatDraftReadinessAge,
  formatDraftReadinessTimestamp,
} from './draft-readiness.js';

export type {
  CoreDraftDataKey,
  OptionalSignalKey,
  DraftReadinessKey,
  DraftReadinessClassification,
  DraftReadinessAvailability,
  DraftReadinessProblem,
  DraftReadinessItemStatus,
  DraftReadinessDefinition,
  DraftReadinessDependencyObservation,
  DraftReadinessSourceObservation,
  DraftReadinessWarningInput,
  DraftReadinessWarning,
  DraftReadinessItem,
  DraftReadinessReport,
  EvaluateDraftReadinessInput,
} from './draft-readiness.js';

export { isRosterRequirements } from './league-settings.js';

export { localDevPorts } from './local-dev.js';

export { LIVE_RECOMMENDATION_ARCHITECTURE } from './recommendation-policy.js';
