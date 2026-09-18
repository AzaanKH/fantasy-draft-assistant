import {
  type ContractPlayerData,
  type PlayerIdentityData,
  type SleeperADPPlayer,
} from '@/lib/calculations';
import type { NFLTeam, PlayerPrediction, TeamEnvironment } from '@fantasy-draft/shared';


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
  modelVersion: string;
  modelPredictionsEnabled: boolean;
  contractSignalEnabled: boolean;
  pickEvOverrideEnabled: boolean;
  pickEvOverrideThreshold: number;
  fallback: 'model' | 'fantasypros-ecr-market';
  shadowLogging: {
    enabled: boolean;
    season: number;
    endpoint: string;
  };
  reason: string;
}

