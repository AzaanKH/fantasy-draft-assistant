// Player types
export { MAX_DRAFT_TEAMS, MAX_DRAFT_ROUNDS, MAX_DRAFT_PICKS, MAX_ROSTER_SPOTS, isBoundedInteger, isDraftSize } from './limits.js';
export {
  NFL_TEAMS,
  POSITIONS,
  isPosition,
  isNFLTeam,
  isPredictionSource,
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
  DEFAULT_ROSTER_REQUIREMENTS,
  createEmptyRoster,
  isNeedPriority,
} from './draft.js';

export type {
  Roster,
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
} from './scrapers.js';

// FantasyPros snapshot types
export {
  isFantasyProsSnapshotSource,
} from './fantasypros.js';

export type {
  FantasyProsProjection,
  FantasyProsAdpPlayer,
  FantasyProsNewsItem,
  FantasyProsSnapshot,
} from './fantasypros.js';

// Sync types
export { isDraftSessionSummary } from './sessions.js';
export type { DraftSessionSummary } from './sessions.js';
export {
  DraftSyncEngine,
  isDraftProvider,
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
  ShadowRecommendationEvent,
} from './shadow.js';

export { optimizeLineupUtility } from './lineup-utility.js';
export type { LineupPlayer } from './lineup-utility.js';

// Sportsbook market snapshots and projection adjustments
export {
  americanOddsToImpliedProbability,
  calculateSportsbookProjectionAdjustment,
  isSportsbookSnapshot,
  normalizeSportsbookPlayerName,
} from './sportsbook.js';

export type {
  SportsbookOverUnderLine,
  SportsbookSnapshot,
  FantasyProsMarketStats,
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
  DraftReadinessKey,
  DraftReadinessDefinition,
  DraftReadinessDependencyObservation,
  DraftReadinessSourceObservation,
  DraftReadinessWarningInput,
  DraftReadinessWarning,
  DraftReadinessItem,
  DraftReadinessReport,
} from './draft-readiness.js';

export { isRosterRequirements } from './league-settings.js';

export { localDevPorts } from './local-dev.js';

export { LIVE_RECOMMENDATION_ARCHITECTURE } from './recommendation-policy.js';

// One-click Core Draft Data refresh, shared by the preflight, local API and workspace.
export {
  DRAFT_DATA_REFRESH_STEPS,
  REFRESHABLE_CORE_DRAFT_DATA_KEYS,
  isDraftDataRefreshStatus,
} from './draft-data-refresh.js';

export type {
  DraftDataRefreshState,
  DraftDataRefreshStepState,
  DraftDataRefreshStatus,
} from './draft-data-refresh.js';

export { createSlotSequence } from './draft-order.js';
export type { DraftFormat, SlotRef, SlotSequence } from './draft-order.js';

export { deriveDraft } from './derive-draft.js';
export type { DraftSource, DraftSelection, DraftKeeper, DerivedDraft } from './derive-draft.js';
