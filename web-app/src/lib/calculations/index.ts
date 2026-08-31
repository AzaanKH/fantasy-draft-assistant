// Value calculation
export { calculateValueScore } from './value';

// League-adjusted positional tiers
export {
  applyPositionTiers,
  calculateTierAvailability,
  getTierKey,
} from './tiers';
export type { TierAvailability } from './tiers';

// Highlight level determination
export {
  determineHighlightLevel,
  determineHighlightLevelForPlayer,
} from './highlight';

// Positional scarcity
export {
  ELITE_THRESHOLDS,
  calculatePositionalScarcity,
  calculateAllScarcityScores,
} from './scarcity';

// Team needs
export {
  calculateTeamNeeds,
  getCriticalPositions,
  isPositionNeed,
} from './team-needs';

// Recommendations
export {
  getRecommendations,
  getTopRecommendation,
} from './recommendations';

export type {
  RecommendationContext,
  RecommendationResult,
  RecommendationSelection,
  RecommendationSelectionPolicy,
} from './recommendations';

export {
  BEST_PICK_ECR_NEIGHBORHOOD,
  BEST_PICK_LEAGUE_VALUE_MAX,
  BEST_PICK_ROSTER_FIT_MAX,
  BEST_PICK_TIER_SUPPLY_MAX,
  evaluateBestPickPolicy,
} from './best-pick-policy';
export type {
  BestPickPolicyContext,
  BestPickPolicyEvaluation,
  BestPickPolicyResult,
} from './best-pick-policy';

export { estimatePlayerPrediction } from './prediction-score';

export type { PredictionLayerResult } from './prediction-score';

export { calculateLeagueProjection } from './league-scoring';
export type { LeagueProjectionResult } from './league-scoring';

export { calculatePlayerRisk } from './risk';
export type { PlayerRiskAssessment, RiskLevel } from './risk';

export {
  applyLeagueSurvivalModel,
  estimateLeagueSurvivalProbability,
  getNextUserPick,
} from './survival';

export type {
  LeagueSurvivalAdpBucket,
  LeagueSurvivalManagerTendency,
  LeagueSurvivalModel,
  LeagueSurvivalPositionSummary,
  SurvivalContext,
} from './survival';

// Legacy exports from player-value (for backwards compatibility)
export {
  calculateHighlightLevel,
  normalizePlayerName,
  createPlayerKey,
  mergePlayerData,
  filterByPosition,
  filterDrafted,
  sortPlayers,
} from './player-value';

export type {
  SleeperADPPlayer,
  ContractPlayerData,
  PlayerIdentityData,
  PlayerMergeLeagueContext,
  SortField,
  SortDirection,
} from './player-value';

export { buildRecommendationPlayerVariants } from './recommendation-player-variants';
export type {
  CorePlayerDataSources,
  OptionalPlayerSignals,
  RecommendationPlayerVariants,
} from './recommendation-player-variants';
