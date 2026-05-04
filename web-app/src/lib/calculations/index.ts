// Value calculation
export { calculateValueScore } from './value';

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

export type { RecommendationResult } from './recommendations';

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
  SortField,
  SortDirection,
} from './player-value';
