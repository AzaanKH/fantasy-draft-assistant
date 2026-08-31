import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Player, Position } from '@fantasy-draft/shared';
import { normalizePlayerName } from '@/lib/calculations';
import {
  canonicalizeKeeperSupply,
  isKeeperSupplyComplete,
} from '@/lib/keeper-supply';
import {
  useDraftStore,
  type PreloadedKeeper,
} from '@/stores/draftStore';

interface CurrentKeeperEntry {
  readonly playerId?: string;
  readonly playerName: string;
  readonly position: Position;
  /** One-based league team number. */
  readonly team: number;
  readonly round: number;
  readonly isMyKeeper?: boolean;
}

interface CurrentKeepersFile {
  readonly updatedAt: string | null;
  readonly season: number;
  readonly keepers: readonly CurrentKeeperEntry[];
}

export interface KeeperPreloadStatus {
  readonly season?: number;
  readonly confirmedAt: string | null;
  readonly configuredCount: number;
  readonly resolvedCount: number;
  readonly canonicalCount: number;
  readonly unresolvedNames: readonly string[];
  /** Keeper entries that resolved to a player already kept by another entry. */
  readonly duplicateNames: readonly string[];
  /** Keeper entries with an illegal team/round or a team/round collision. */
  readonly invalidAssignments: readonly string[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isInitialized: boolean;
  readonly isConfirmed: boolean;
  readonly isMockReady: boolean;
  readonly error: Error | null;
}

const POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPosition(value: unknown): value is Position {
  return typeof value === 'string' && POSITIONS.includes(value as Position);
}

function isCurrentKeeperEntry(value: unknown): value is CurrentKeeperEntry {
  return (
    isRecord(value) &&
    (value['playerId'] === undefined || typeof value['playerId'] === 'string') &&
    typeof value['playerName'] === 'string' &&
    isPosition(value['position']) &&
    typeof value['team'] === 'number' &&
    Number.isInteger(value['team']) &&
    value['team'] >= 1 &&
    typeof value['round'] === 'number' &&
    Number.isInteger(value['round']) &&
    value['round'] >= 1 &&
    (value['isMyKeeper'] === undefined || typeof value['isMyKeeper'] === 'boolean')
  );
}

function isCurrentKeepersFile(value: unknown): value is CurrentKeepersFile {
  return (
    isRecord(value) &&
    (value['updatedAt'] === null || typeof value['updatedAt'] === 'string') &&
    typeof value['season'] === 'number' &&
    Number.isFinite(value['season']) &&
    Array.isArray(value['keepers']) &&
    value['keepers'].every(isCurrentKeeperEntry)
  );
}

async function fetchCurrentKeepers(): Promise<CurrentKeepersFile> {
  const response = await fetch('/api/draft-data/current-keepers');
  if (!response.ok) {
    throw new Error(`Failed to load current keepers: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isCurrentKeepersFile(parsed)) {
    throw new Error('Invalid current keeper data format');
  }
  return parsed;
}

function getKeeperKey(name: string, position: Position): string {
  return `${normalizePlayerName(name)}:${position}`;
}

function getKeeperSupplySignature(keepers: readonly PreloadedKeeper[]): string {
  return keepers
    .map((keeper) => [
      keeper.playerId,
      keeper.position,
      keeper.teamIndex,
      keeper.round,
    ].join(':'))
    .sort((left, right) => left.localeCompare(right))
    .join('\0');
}

function getAssignmentLabel(keeper: PreloadedKeeper): string {
  return `${keeper.playerName}, team ${String(keeper.teamIndex + 1)}, round ${String(keeper.round)}`;
}

export function useKeeperPreload(
  players: readonly Player[],
  playersLoading: boolean
): KeeperPreloadStatus {
  const keepersInitialized = useDraftStore((state) => state.keepersInitialized);
  const keepersEnabled = useDraftStore(
    (state) => state.leagueSettings.keepersEnabled
  );
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const totalRounds = useDraftStore((state) => state.config.totalRounds);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const preloadKeepers = useDraftStore((state) => state.preloadKeepers);
  const query = useQuery({
    queryKey: ['current-keepers'],
    queryFn: fetchCurrentKeepers,
    staleTime: Infinity,
  });

  const resolution = useMemo(() => {
    if (keepersEnabled === false || !query.data || playersLoading) {
      return {
        resolved: [] as PreloadedKeeper[],
        unresolvedNames: [] as string[],
        duplicateNames: [] as string[],
        invalidAssignments: [] as string[],
        canonicalAssignments: [] as PreloadedKeeper[],
      };
    }

    const playersById = new Map(players.map((player) => [player.id, player]));
    const playersByKey = new Map(
      players.map((player) => [getKeeperKey(player.name, player.position), player])
    );
    const resolved: PreloadedKeeper[] = [];
    const unresolvedNames: string[] = [];
    const resolvedPlayerIds = new Set<string>();
    const duplicateNames: string[] = [];

    for (const keeper of query.data.keepers) {
      const player = (keeper.playerId ? playersById.get(keeper.playerId) : undefined) ??
        playersByKey.get(getKeeperKey(keeper.playerName, keeper.position));
      if (!player || player.position !== keeper.position) {
        unresolvedNames.push(keeper.playerName);
        continue;
      }
      if (resolvedPlayerIds.has(player.id)) {
        duplicateNames.push(keeper.playerName);
      } else {
        resolvedPlayerIds.add(player.id);
      }
      resolved.push({
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        teamIndex: keeper.team - 1,
        round: keeper.round,
        isMyKeeper: keeper.isMyKeeper ?? false,
      });
    }

    const supply = canonicalizeKeeperSupply(resolved, {
      totalTeams,
      totalRounds,
    });
    const invalidAssignments = [
      ...supply.invalidEntries.map(getAssignmentLabel),
      ...supply.conflictingEntries.map(
        (keeper) => `${getAssignmentLabel(keeper)} conflicts with another keeper`
      ),
    ];

    return {
      resolved,
      unresolvedNames,
      duplicateNames,
      invalidAssignments,
      canonicalAssignments: supply.assignments,
    };
  }, [keepersEnabled, players, playersLoading, query.data, totalRounds, totalTeams]);

  const configuredCount = keepersEnabled === false ? 0 : query.data?.keepers.length ?? 0;
  const isConfirmed = keepersEnabled === false || (
    query.data?.updatedAt !== null && query.data?.updatedAt !== undefined
  );
  const expectedSeason = new Date().getUTCFullYear();
  const expectedCount = keepersEnabled === false ? 0 : totalTeams;
  const supplyIsComplete = isKeeperSupplyComplete({
    keepersEnabled,
    season: query.data?.season,
    expectedSeason,
    isConfirmed,
    configuredCount,
    expectedCount,
    resolvedCount: resolution.resolved.length,
    canonicalCount: resolution.canonicalAssignments.length,
    unresolvedNames: resolution.unresolvedNames,
    duplicateNames: resolution.duplicateNames,
    invalidAssignments: resolution.invalidAssignments,
  });

  useEffect(() => {
    if (keepersEnabled === false) {
      preloadKeepers([]);
      return;
    }
    if (!query.data || playersLoading) return;
    if (!supplyIsComplete) {
      preloadKeepers([], false);
      return;
    }
    preloadKeepers(resolution.resolved);
  }, [
    keepersEnabled,
    playersLoading,
    preloadKeepers,
    query.data,
    resolution.resolved,
    supplyIsComplete,
  ]);

  const isLoading = keepersEnabled === false ? false : query.isLoading || playersLoading;
  const isInitialized =
    keepersInitialized &&
    supplyIsComplete &&
    !isLoading &&
    (keepersEnabled === false || !query.isError) &&
    getKeeperSupplySignature(preloadedKeepers) ===
      getKeeperSupplySignature(resolution.canonicalAssignments);

  return {
    season: query.data?.season,
    confirmedAt: query.data?.updatedAt ?? null,
    configuredCount,
    resolvedCount: resolution.resolved.length,
    canonicalCount: resolution.canonicalAssignments.length,
    unresolvedNames: resolution.unresolvedNames,
    duplicateNames: resolution.duplicateNames,
    invalidAssignments: resolution.invalidAssignments,
    isLoading,
    isError: keepersEnabled === false ? false : query.isError,
    isInitialized,
    isConfirmed,
    error: query.error ?? null,
    isMockReady:
      isInitialized && supplyIsComplete,
  };
}
