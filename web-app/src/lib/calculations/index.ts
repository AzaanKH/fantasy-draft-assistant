// Positional scarcity
export { calculateAllScarcityScores } from './scarcity';

// Team needs
export {
  calculateTeamNeeds,
  getCriticalPositions,
} from './team-needs';

// Recommendations
export {
  getRecommendationBoard,
  getRecommendations,
} from './recommendations';

export type {
  RecommendationContext,
  RecommendationResult,
  RecommendationSelection,
} from './recommendations';

// League survival
export { applyLeagueSurvivalModel } from './survival';

// Player data merging and filtering
export {
  normalizePlayerName,
  filterDrafted,
} from './player-value';

export type {
  SleeperADPPlayer,
  ContractPlayerData,
  PlayerIdentityData,
} from './player-value';
