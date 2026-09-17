import { fantasyProsProvider } from '@/lib/providers/fantasypros';
import type {
  FantasyProsSnapshot,
  MarketAdpFormat,
  MarketAdpSnapshot,
  SportsbookSnapshot,
} from '@fantasy-draft/shared';
import { isMarketAdpSnapshot, isSportsbookSnapshot } from '@fantasy-draft/shared';

import type {
  ContractDataFile,
  PlayerIdentityFile,
  PredictionsDataFile,
  RecommendationPolicyFile,
  SleeperDataFile,
  TeamEnvDataFile,
} from './types';
import {
  isContractDataFile,
  isPlayerIdentityFile,
  isPredictionsDataFile,
  isRecommendationPolicyFile,
} from './validators';

/**
 * Fetch FantasyPros snapshot data
 */
export async function fetchFantasyProsSnapshot(): Promise<FantasyProsSnapshot> {
  return fantasyProsProvider.getSnapshot();
}

/**
 * Fetch Sleeper ADP data
 */
export async function fetchSleeperData(): Promise<SleeperDataFile> {
  const response = await fetch('/data/sleeper-adp.json');
  if (!response.ok) {
    throw new Error(`Failed to load Sleeper data: ${String(response.status)}`);
  }
  return response.json() as Promise<SleeperDataFile>;
}

/**
 * Fetch team environment data
 */
export async function fetchTeamEnvData(): Promise<TeamEnvDataFile> {
  const response = await fetch('/data/team-environment.json');
  if (!response.ok) {
    throw new Error(`Failed to load team environment data: ${String(response.status)}`);
  }
  return response.json() as Promise<TeamEnvDataFile>;
}

/**
 * Fetch contract year data
 */
export async function fetchContractData(): Promise<ContractDataFile> {
  const response = await fetch('/data/contracts.json');
  if (!response.ok) {
    throw new Error(`Failed to load contract data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isContractDataFile(parsed)) {
    throw new Error('Invalid contract data format');
  }
  return parsed;
}

export async function fetchPredictionData(): Promise<PredictionsDataFile> {
  const response = await fetch('/data/predictions.json');
  if (response.status === 404) {
    return { generatedAt: null, modelVersion: 'none', players: [] };
  }
  if (!response.ok) {
    throw new Error(`Failed to load prediction data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isPredictionsDataFile(parsed)) {
    throw new Error('Invalid prediction data format');
  }
  return parsed;
}

export async function fetchPlayerIdentityData(): Promise<PlayerIdentityFile> {
  const response = await fetch('/data/player-identity.json');
  if (!response.ok) {
    throw new Error(`Failed to load player identity data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isPlayerIdentityFile(parsed)) {
    throw new Error('Invalid player identity data format');
  }
  return parsed;
}

export async function fetchRecommendationPolicy(): Promise<RecommendationPolicyFile> {
  const response = await fetch('/data/recommendation-policy.json');
  if (!response.ok) {
    throw new Error(`Failed to load recommendation policy: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isRecommendationPolicyFile(parsed)) {
    throw new Error('Invalid recommendation policy format');
  }
  return parsed;
}

export async function fetchSportsbookSnapshot(): Promise<SportsbookSnapshot> {
  const response = await fetch('/api/draft-data/sportsbook');
  if (!response.ok) {
    throw new Error(`Failed to load sportsbook data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isSportsbookSnapshot(parsed)) {
    throw new Error('Invalid sportsbook data format');
  }
  return parsed;
}

export function getMarketAdpFormat(receptions: number): MarketAdpFormat {
  if (receptions >= 0.75) return 'ppr';
  if (receptions >= 0.25) return 'half-ppr';
  return 'standard';
}

export async function fetchMarketAdp(
  format: MarketAdpFormat,
  teams: number,
  season: number
): Promise<MarketAdpSnapshot> {
  const params = new URLSearchParams({
    format,
    teams: String(teams),
    season: String(season),
  });
  const response = await fetch(`/api/market-adp?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load Fantasy Football Calculator ADP: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isMarketAdpSnapshot(parsed)) {
    throw new Error('Invalid Fantasy Football Calculator ADP format');
  }
  return parsed;
}

