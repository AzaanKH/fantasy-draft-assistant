export { isNeedPriority } from '../draft.js';
export type {
  DraftPick,
  NeedPriority,
  PositionNeed,
  ExpectedNextPickAlternative,
  RecommendationDecisionFactors,
  Recommendation,
  DecisionLens,
  DecisionDivergenceFactor,
  DecisionOutput,
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

export { DEFAULT_QUICK_MOCK, isQuickMockPreferences, createQuickMockSettings } from './quick-mock-settings.js';
export type { QuickMockPreferences } from './quick-mock-settings.js';
export { getNextOpenPickNumber, resolveDraftPickImports } from './draft-pick-imports.js';
export type { DraftPickImportRejection, DraftPickImportResult } from './draft-pick-imports.js';
export { evaluateWorkspaceDraftReadiness, blocksLiveRecommendations, blocksRecommendations } from './draft-readiness.js';
export { getKeeperPickNumber, isKeeperSupplyComplete, getEffectiveKeeperAssignments, canonicalizeKeeperSupply } from './keeper-supply.js';
export type { KeeperSupplyEntry, CanonicalKeeperAssignment } from './keeper-supply.js';
export { getKeeperAtPick, selectCpuPlayer, estimateMockSurvivalProbabilities, simulateCpuDraft } from './mock-draft-engine.js';
export type { MockDraftPickLike, MockKeeperAssignment, MockLeagueHistoryModel, MockDraftEngineConfig, SelectCpuPlayerInput, CpuSelection, SimulatedMockPick } from './mock-draft-engine.js';
export type { KeeperPreloadStatus } from './keeper-preload-status.js';

export { isShadowRecommendationEvent } from '../shadow.js';
export type { ShadowRecommendation, ShadowRecommendationEvent } from '../shadow.js';
export { optimizeLineupUtility } from '../lineup-utility.js';
export type { LineupPlayer } from '../lineup-utility.js';
export { LIVE_RECOMMENDATION_ARCHITECTURE } from '../recommendation-policy.js';
