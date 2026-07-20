/**
 * Player Data Hook
 *
 * Loads and transforms player data from multiple sources:
 * - ECR rankings from FantasyPros
 * - ADP from Sleeper
 * - Team environment data
 * - Contract year data
 *
 * Applies filtering, sorting, and drafted player exclusion.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  FantasyProsSnapshot,
  Player,
  PlayerPrediction,
  Position,
  NFLTeam,
  TeamEnvironment,
} from '@fantasy-draft/shared';
import {
  mergePlayerData,
  filterByPosition,
  filterDrafted,
  sortPlayers,
  type SleeperADPPlayer,
  type ContractPlayerData,
  type PlayerIdentityData,
} from '@/lib/calculations';
import { useDraftStore } from '@/stores/draftStore';
import { fantasyProsProvider } from '@/lib/providers/fantasypros';

/**
 * Sleeper ADP JSON file structure
 */
interface SleeperDataFile {
  fetchedAt: string;
  source: string;
  playerCount: number;
  players: SleeperADPPlayer[];
}

/**
 * Team environment JSON file structure
 */
interface TeamEnvDataFile {
  generatedAt: string;
  season: number;
  teamCount: number;
  teams: Record<NFLTeam, TeamEnvironment>;
}

/**
 * Contract data JSON file structure
 */
interface ContractDataFile {
  generatedAt?: string | null;
  scrapedAt?: string | null;
  contractYear: number;
  playerCount: number;
  players: ContractPlayerData[];
}

interface PredictionsDataFile {
  generatedAt: string | null;
  modelVersion: string;
  players: PlayerPrediction[];
}

interface PlayerIdentityFile {
  generatedAt: string;
  season: number;
  players: PlayerIdentityData[];
}

interface RecommendationPolicyFile {
  generatedAt: string;
  modelVersion: string;
  modelPredictionsEnabled: boolean;
  contractSignalEnabled: boolean;
  fallback: 'model' | 'fantasypros-ecr-market';
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlayerIdentityFile(value: unknown): value is PlayerIdentityFile {
  return (
    isRecord(value) &&
    typeof value['generatedAt'] === 'string' &&
    typeof value['season'] === 'number' &&
    Number.isFinite(value['season']) &&
    Array.isArray(value['players'])
  );
}

function isRecommendationPolicyFile(value: unknown): value is RecommendationPolicyFile {
  return (
    isRecord(value) &&
    typeof value['generatedAt'] === 'string' &&
    typeof value['modelVersion'] === 'string' &&
    typeof value['modelPredictionsEnabled'] === 'boolean' &&
    typeof value['contractSignalEnabled'] === 'boolean' &&
    (value['fallback'] === 'model' || value['fallback'] === 'fantasypros-ecr-market') &&
    typeof value['reason'] === 'string'
  );
}

/**
 * Fetch FantasyPros snapshot data
 */
async function fetchFantasyProsSnapshot(): Promise<FantasyProsSnapshot> {
  return fantasyProsProvider.getSnapshot();
}

/**
 * Fetch Sleeper ADP data
 */
async function fetchSleeperData(): Promise<SleeperDataFile> {
  const response = await fetch('/data/sleeper-adp.json');
  if (!response.ok) {
    throw new Error(`Failed to load Sleeper data: ${String(response.status)}`);
  }
  return response.json() as Promise<SleeperDataFile>;
}

/**
 * Fetch team environment data
 */
async function fetchTeamEnvData(): Promise<TeamEnvDataFile> {
  const response = await fetch('/data/team-environment.json');
  if (!response.ok) {
    throw new Error(`Failed to load team environment data: ${String(response.status)}`);
  }
  return response.json() as Promise<TeamEnvDataFile>;
}

/**
 * Fetch contract year data
 */
async function fetchContractData(): Promise<ContractDataFile> {
  const response = await fetch('/data/contracts.json');
  if (!response.ok) {
    throw new Error(`Failed to load contract data: ${String(response.status)}`);
  }
  return response.json() as Promise<ContractDataFile>;
}

async function fetchPredictionData(): Promise<PredictionsDataFile> {
  const response = await fetch('/data/predictions.json');
  if (response.status === 404) {
    return { generatedAt: null, modelVersion: 'none', players: [] };
  }
  if (!response.ok) {
    throw new Error(`Failed to load prediction data: ${String(response.status)}`);
  }
  return response.json() as Promise<PredictionsDataFile>;
}

async function fetchPlayerIdentityData(): Promise<PlayerIdentityFile> {
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

async function fetchRecommendationPolicy(): Promise<RecommendationPolicyFile> {
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

/**
 * Hook to load and merge all player data sources
 */
export function usePlayerDataQuery() {
  const fantasyProsQuery = useQuery({
    queryKey: ['fantasypros-snapshot'],
    queryFn: fetchFantasyProsSnapshot,
    staleTime: Infinity, // Data doesn't change during draft
  });

  const sleeperQuery = useQuery({
    queryKey: ['sleeper-adp'],
    queryFn: fetchSleeperData,
    staleTime: Infinity,
  });

  const teamEnvQuery = useQuery({
    queryKey: ['team-environment'],
    queryFn: fetchTeamEnvData,
    staleTime: Infinity,
  });

  const contractQuery = useQuery({
    queryKey: ['contracts'],
    queryFn: fetchContractData,
    staleTime: Infinity,
  });

  const predictionQuery = useQuery({
    queryKey: ['predictions'],
    queryFn: fetchPredictionData,
    staleTime: Infinity,
  });
  const identityQuery = useQuery({
    queryKey: ['player-identity'],
    queryFn: fetchPlayerIdentityData,
    staleTime: Infinity,
  });
  const recommendationPolicyQuery = useQuery({
    queryKey: ['recommendation-policy'],
    queryFn: fetchRecommendationPolicy,
    staleTime: Infinity,
  });

  const isLoading =
    fantasyProsQuery.isLoading ||
    sleeperQuery.isLoading ||
    teamEnvQuery.isLoading ||
    predictionQuery.isLoading ||
    identityQuery.isLoading ||
    recommendationPolicyQuery.isLoading;

  const isError =
    fantasyProsQuery.isError ||
    sleeperQuery.isError ||
    teamEnvQuery.isError ||
    predictionQuery.isError ||
    identityQuery.isError ||
    recommendationPolicyQuery.isError;

  const error =
    fantasyProsQuery.error ??
    sleeperQuery.error ??
    teamEnvQuery.error ??
    predictionQuery.error ??
    identityQuery.error ??
    recommendationPolicyQuery.error;

  // Merge all data sources into Player objects
  const players = useMemo<Player[]>(() => {
    if (
      !fantasyProsQuery.data ||
      !sleeperQuery.data ||
      !teamEnvQuery.data ||
      !identityQuery.data ||
      !recommendationPolicyQuery.data
    ) {
      return [];
    }

    return mergePlayerData(
      fantasyProsQuery.data.rankings,
      fantasyProsQuery.data.projections,
      fantasyProsQuery.data.news,
      sleeperQuery.data.players,
      teamEnvQuery.data.teams,
      recommendationPolicyQuery.data.contractSignalEnabled
        ? contractQuery.data?.players ?? []
        : [],
      recommendationPolicyQuery.data.modelPredictionsEnabled
        ? predictionQuery.data?.players ?? []
        : [],
      fantasyProsQuery.data.adp ?? [],
      identityQuery.data.players
    );
  }, [fantasyProsQuery.data, sleeperQuery.data, teamEnvQuery.data, contractQuery.data, predictionQuery.data, identityQuery.data, recommendationPolicyQuery.data]);

  return {
    players,
    isLoading,
    isError,
    error,
    dataInfo: {
      fantasyProsRefreshedAt: fantasyProsQuery.data?.metadata.refreshedAt,
      fantasyProsSource: fantasyProsQuery.data?.metadata.source,
      fantasyProsSourceType: fantasyProsQuery.data?.metadata.sourceType,
      sleeperFetchedAt: sleeperQuery.data?.fetchedAt,
      fantasyProsCount: fantasyProsQuery.data?.metadata.rankingCount ?? 0,
      sleeperCount: sleeperQuery.data?.playerCount ?? 0,
      contractsError: contractQuery.error ?? null,
      predictionModelVersion: predictionQuery.data?.modelVersion,
      modelPredictionsEnabled: recommendationPolicyQuery.data?.modelPredictionsEnabled ?? false,
      recommendationFallback: recommendationPolicyQuery.data?.fallback,
      recommendationPolicyReason: recommendationPolicyQuery.data?.reason,
      predictionsError: predictionQuery.error ?? null,
    },
  };
}

/**
 * Hook to get filtered and sorted player data
 * Combines data loading with draft store state
 */
export function useFilteredPlayers() {
  const { players, isLoading, isError, error, dataInfo } = usePlayerDataQuery();

  const filter = useDraftStore((state) => state.filter);
  const sort = useDraftStore((state) => state.sort);
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);

  const filteredPlayers = useMemo(() => {
    let result = players;

    // Filter by position
    result = filterByPosition(result, filter.position);

    // Filter out drafted players
    result = filterDrafted(result, draftedPlayerIds);

    // Filter by search query
    if (filter.searchQuery.trim()) {
      const query = filter.searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.team.toLowerCase().includes(query)
      );
    }

    // Sort
    result = sortPlayers(result, sort.field, sort.direction);

    return result;
  }, [players, filter, sort, draftedPlayerIds]);

  return {
    players: filteredPlayers,
    totalCount: players.length,
    filteredCount: filteredPlayers.length,
    isLoading,
    isError,
    error,
    dataInfo,
  };
}

/**
 * Hook to get position-specific statistics
 */
export function usePositionStats() {
  const { players } = usePlayerDataQuery();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);

  return useMemo(() => {
    const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const stats: Record<Position, { total: number; available: number }> = {
      QB: { total: 0, available: 0 },
      RB: { total: 0, available: 0 },
      WR: { total: 0, available: 0 },
      TE: { total: 0, available: 0 },
      K: { total: 0, available: 0 },
      DEF: { total: 0, available: 0 },
    };

    for (const player of players) {
      const pos = player.position;
      if (positions.includes(pos)) {
        stats[pos].total += 1;
        if (!draftedPlayerIds.has(player.id)) {
          stats[pos].available += 1;
        }
      }
    }

    return stats;
  }, [players, draftedPlayerIds]);
}

/**
 * Hook to get a specific player by ID
 */
export function usePlayer(playerId: string): Player | undefined {
  const { players } = usePlayerDataQuery();
  return useMemo(
    () => players.find((p) => p.id === playerId),
    [players, playerId]
  );
}
