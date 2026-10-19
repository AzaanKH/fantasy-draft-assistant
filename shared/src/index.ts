// Player types
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
