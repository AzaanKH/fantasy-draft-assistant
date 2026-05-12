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
  scrapedAt: string | null;
  contractYear: number;
  playerCount: number;
  players: ContractPlayerData[];
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
    throw new Error(`Failed to load Sleeper data: ${response.status}`);
  }
  return response.json() as Promise<SleeperDataFile>;
}

/**
 * Fetch team environment data
 */
async function fetchTeamEnvData(): Promise<TeamEnvDataFile> {
  const response = await fetch('/data/team-environment.json');
  if (!response.ok) {
    throw new Error(`Failed to load team environment data: ${response.status}`);
  }
  return response.json() as Promise<TeamEnvDataFile>;
}

/**
 * Fetch contract year data
 */
async function fetchContractData(): Promise<ContractDataFile> {
  const response = await fetch('/data/contracts.json');
  if (!response.ok) {
    throw new Error(`Failed to load contract data: ${response.status}`);
  }
  return response.json() as Promise<ContractDataFile>;
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

  const isLoading =
    fantasyProsQuery.isLoading ||
    sleeperQuery.isLoading ||
    teamEnvQuery.isLoading;

  const isError =
    fantasyProsQuery.isError ||
    sleeperQuery.isError ||
    teamEnvQuery.isError;

  const error =
    fantasyProsQuery.error ?? sleeperQuery.error ?? teamEnvQuery.error;

  // Merge all data sources into Player objects
  const players = useMemo<Player[]>(() => {
    if (
      !fantasyProsQuery.data ||
      !sleeperQuery.data ||
      !teamEnvQuery.data
    ) {
      return [];
    }

    return mergePlayerData(
      fantasyProsQuery.data.rankings,
      fantasyProsQuery.data.projections,
      fantasyProsQuery.data.news,
      sleeperQuery.data.players,
      teamEnvQuery.data.teams,
      contractQuery.data?.players ?? []
    );
  }, [fantasyProsQuery.data, sleeperQuery.data, teamEnvQuery.data, contractQuery.data]);

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
