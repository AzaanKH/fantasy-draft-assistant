export { createEmptyRoster, DEFAULT_ROSTER_REQUIREMENTS, isNeedPriority } from '../draft.js';
export type {
  Roster, RosterRequirements, DraftPick, NeedPriority, PositionNeed,
  ExpectedNextPickAlternative, RecommendationDecisionFactors, Recommendation,
  DecisionLens, DecisionDivergenceFactor, DecisionOutput,
} from '../draft.js';

export {
  type AssistantAnswerRow,
  getAvailabilitySignal,
  getComparisonHighlights,
  getRosterAnswer,
  getWaitAnswer,
  getWaitingCostSummary,
  getWhyRows,
  type PoolSort,
  sortRecommendationsForPool,
  survivalPercent,
} from './assistant/assistant-analysis.js';
export {
  comparisonBar,
  type ComparisonMetric,
  getComparisonMetrics,
} from './assistant/comparison-metrics.js';
export { type ContractPlayerData, filterDrafted } from './calculations/player-value.js';
export { getCriticalPositions } from './calculations/team-needs.js';
export type { RecommendationContext, RecommendationSelection } from './calculations/recommendations.js';
export {
  mergePlayerData,
  normalizePlayerName,
  type PlayerIdentityData,
  type SleeperADPPlayer,
} from './calculations/player-value.js';
export {
  type CorePlayerDataSources,
  mergeCoreSources,
} from './calculations/recommendation-player-variants.js';
export {
  getRecommendationBoard,
  getRecommendations,
  type RecommendationResult,
} from './calculations/recommendations.js';
export {
  calculateAllScarcityScores,
} from './calculations/scarcity.js';
export {
  applyLeagueSurvivalModel,
  estimateLeagueSurvivalProbability,
  getNextUserPick,
  type LeagueSurvivalModel,
} from './calculations/survival.js';
export {
  calculateTeamNeeds,
} from './calculations/team-needs.js';
export {
  applyPositionTiers,
  calculateTierAvailability,
  getTierKey,
} from './calculations/tiers.js';
export {
  createDraftDisplayContext,
  type DraftDisplayContext,
} from './display-context.js';
export {
  formatSignedNumber,
} from './format.js';
export type {
  HelpMetric,
} from './help-metric.js';
export {
  createDraftDecisionOutput,
  createDraftDecisionView,
  type DraftDecisionOutput,
  type DraftDecisionView,
  getPreferredRecommendation,
  getRecommendationPolicyLabel,
} from './recommendations/draft-decision.js';
export {
  getRecommendationExplanation,
} from './recommendations/recommendation-explanation.js';
export {
  createSlotSequence,
  type DraftFormat,
  type SlotRef,
  type SlotSequence,
} from '../draft-order.js';
export {
  deriveDraft,
  type DraftSource,
  type DraftSelection,
  type DraftKeeper,
  type DerivedDraft,
} from '../derive-draft.js';
