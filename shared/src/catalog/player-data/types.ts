import { type ContractPlayerData } from '../../draft/calculations/player-value.js';
import { type NFLTeam } from '../../player.js';
import { type TeamEnvironment } from '../../team-environment.js';


export type { SleeperDataFile, PlayerIdentityFile, PredictionsDataFile } from '../decoders.js';

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
