import { type ContractPlayerData, type PlayerIdentityData, type SleeperADPPlayer } from '../../draft/calculations/player-value.js';
import { type NFLTeam, type PlayerPrediction } from '../../player.js';
import { type TeamEnvironment } from '../../team-environment.js';


/**
 * Sleeper ADP JSON file structure
 */
export interface SleeperDataFile {
  fetchedAt: string;
  source: string;
  playerCount: number;
  players: SleeperADPPlayer[];
}

/**
 * Team environment JSON file structure
 */
export interface TeamEnvDataFile {
  generatedAt: string;
  season: number;
  teamCount: number;
  teams: Record<NFLTeam, TeamEnvironment>;
}

/**
 * Contract data JSON file structure
 */
export interface ContractDataFile {
  generatedAt?: string | null;
  scrapedAt?: string | null;
  contractYear: number;
  playerCount: number;
  players: ContractPlayerData[];
}

export interface PredictionsDataFile {
  generatedAt: string | null;
  modelVersion: string;
  players: PlayerPrediction[];
}

export interface PlayerIdentityFile {
  generatedAt: string;
  season: number;
  coverage: {
    fantasyProsRankingMatchRate: number;
    matchedDefenses: number;
  };
  players: PlayerIdentityData[];
}

export interface RecommendationPolicyFile {
  generatedAt: string;
  recommendationArchitecture: typeof import('../../recommendation-policy.js').LIVE_RECOMMENDATION_ARCHITECTURE;
  modelPredictionsEnabled: boolean;
  contractSignalEnabled: boolean;
  fallback: 'model' | 'fantasypros-ecr-market';
  shadowLogging: {
    enabled: boolean;
    season: number;
    endpoint: string;
  };
  reason: string;
}
