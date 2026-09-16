// Player types
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
} from './player';

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
} from './player';

// Draft types
export {
  NEED_PRIORITIES,
  DEFAULT_ROSTER_REQUIREMENTS,
  createEmptyRoster,
  createInitialDraftState,
  isNeedPriority,
  DECISION_LENSES,
  DECISION_DIVERGENCE_FACTORS,
} from './draft';

export type {
  Roster,
  PositionRequirement,
  FlexRequirement,
  RosterRequirements,
  DraftState,
  DraftPick,
  NeedPriority,
  PositionNeed,
  RecommendationDecisionFactors,
  ExpectedNextPickAlternative,
  Recommendation,
  DecisionLens,
  DecisionDivergenceFactor,
  DecisionOutput,
} from './draft';

// Team environment types
export {
  VOLUME_LEVELS,
  isVolumeLevel,
  isTeamEnvironment,
  isTopOffense,
  isDecentOffense,
} from './team-environment';

export type {
  VolumeLevel,
  TeamEnvironment,
} from './team-environment';

// Scoring types
export { DEFAULT_SCORING_RULES } from './scoring';

export type {
  PassingScoringRules,
  RushingScoringRules,
  ReceivingScoringRules,
  KickingScoringRules,
  PointsAllowedTiers,
  DefenseScoringRules,
  MiscScoringRules,
  ScoringRules,
} from './scoring';

// Normalized league scoring and roster configuration
export {
  createDefaultLeagueSettings,
  createLeagueSettings,
  isLeagueSettings,
  isSleeperLeague,
  normalizeSleeperLeagueSettings,
} from './league-settings';

export type {
  LeagueSettings,
  LeagueSettingsInput,
  LeagueSettingsSource,
  SleeperLeague,
} from './league-settings';

// Observed market ADP
export { isMarketAdpFormat, isMarketAdpSnapshot } from './market-adp';

export type {
  MarketAdpFormat,
  MarketAdpPlayer,
  MarketAdpSnapshot,
} from './market-adp';

// WebSocket types
export {
  WEBSOCKET_EVENT_TYPES,
  isWebSocketEventType,
  isWebSocketEvent,
} from './websocket';

export type {
  WebSocketEvent,
  WebSocketEventType,
  PlayerDraftedEvent,
  UndoDraftEvent,
  StateSyncEvent,
  PickAdvancedEvent,
  ConnectionStatusEvent,
} from './websocket';

// Scraper types
export {
  BYE_WEEKS_2025,
  parsePlayerNameAndTeam,
  parsePositionString,
} from './scrapers';

export type {
  ECRPlayer,
  ContractPlayer,
  RawECRData,
} from './scrapers';

// FantasyPros snapshot types
export {
  FANTASYPROS_SNAPSHOT_SOURCES,
  isFantasyProsSnapshotSource,
} from './fantasypros';

export type {
  FantasyProsSnapshotSource,
  FantasyProsProjection,
  FantasyProsAdpPlayer,
  FantasyProsNewsItem,
  FantasyProsSnapshotMetadata,
  FantasyProsSnapshot,
} from './fantasypros';

// Sync types
export {
  DraftSyncEngine,
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
} from './sync';

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
} from './sync';

// Experimental model shadow-evaluation types
export { isShadowRecommendationEvent } from './shadow';

export type {
  ShadowRecommendation,
  ShadowPositionNeed,
  ShadowRecommendationEvent,
} from './shadow';

// ECR-anchored pick expected-value scoring
export {
  DEFAULT_PICK_EV_LAYERS,
  PICK_EV_ECR_GUARDRAIL,
  PICK_EV_OVERRIDE_THRESHOLD,
  optimizeLineupUtility,
  scorePickEvBoard,
  selectPickEvRecommendation,
} from './pick-ev';

export type {
  PickEvPlayer,
  PickEvRosterPlayer,
  PickEvNeed,
  PickEvContext,
  PickEvLayers,
  PickEvScore,
  PickEvSelection,
} from './pick-ev';

// Sportsbook market snapshots and projection adjustments
export {
  SPORTSBOOKS,
  SPORTSBOOK_MARKETS,
  americanOddsToImpliedProbability,
  calculateSportsbookProjectionAdjustment,
  getLeagueScoringValue,
  isSportsbookSnapshot,
  normalizeSportsbookPlayerName,
} from './sportsbook';

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
} from './sportsbook';

// Product Draft Readiness: Core Draft Data blocks; Optional Signals degrade.
export {
  CORE_DRAFT_DATA_KEYS,
  OPTIONAL_SIGNAL_KEYS,
  DRAFT_READINESS_DEFINITIONS,
  evaluateDraftReadiness,
  formatDraftReadinessAge,
  formatDraftReadinessTimestamp,
} from './draft-readiness';

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
} from './draft-readiness';
