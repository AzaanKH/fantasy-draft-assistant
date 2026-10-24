import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { dispatchWorkspace } from '@/workspace/ui-dispatch';
import { useWorkspace, useDraftState } from '@/workspace/WorkspaceProvider';
import { requestJson } from '@/lib/http';
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { currentSeason, type Player, type Position } from '@fantasy-draft/shared/league';
import { normalizePlayerName, canonicalizeKeeperSupply, isKeeperSupplyComplete, type KeeperPreloadStatus } from '@fantasy-draft/shared/draft';
import { IS_DEMO } from '@/lib/demo-mode';
import { type PreloadedKeeper } from '@/stores/draftStore';
import { decodeKeeperFile, type KeeperFile } from '@fantasy-draft/shared/catalog';

export type { KeeperPreloadStatus } from '@fantasy-draft/shared/draft';

async function fetchCurrentKeepers(): Promise<KeeperFile> {
  return requestJson('/api/draft-data/current-keepers', parsed => {
    try { return decodeKeeperFile(parsed); }
    catch (error) { throw new Error('Invalid current keeper data format: ' + String(error)); }
  }, 'Failed to load current keepers');
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
  const keepersInitialized = useDraftState((state) => state.keepersInitialized);
  const keepersEnabled = useDraftState(
    (state) => state.leagueSettings.keepersEnabled
  );
  const totalTeams = useDraftState((state) => state.config.totalTeams);
  const totalRounds = useDraftState((state) => state.config.totalRounds);
  const draftType = useDraftState((state) => state.config.draftType);
  const preloadedKeepers = useDraftState((state) => state.preloadedKeepers);
  const workspace = useWorkspace();
  const query = useQuery({
    queryKey: ['current-keepers'],
    queryFn: fetchCurrentKeepers,
    // Demo mocks have no keepers and no API server to load them from.
    enabled: keepersEnabled !== false && !IS_DEMO,
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
      draftType,
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
  }, [keepersEnabled, players, playersLoading, query.data, totalRounds, totalTeams, draftType]);

  const configuredCount = keepersEnabled === false ? 0 : query.data?.keepers.length ?? 0;
  const isConfirmed = keepersEnabled === false || (
    query.data?.updatedAt !== null && query.data?.updatedAt !== undefined
  );
  const expectedSeason = currentSeason();
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
      if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'preloadKeepers', []); } else { workspace.send('preloadKeepers', []); }
      return;
    }
    if (!query.data || playersLoading) return;
    if (!supplyIsComplete) {
      if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'preloadKeepers', [], false); } else { workspace.send('preloadKeepers', [], false); }
      return;
    }
    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'preloadKeepers', resolution.resolved); } else { workspace.send('preloadKeepers', resolution.resolved); }
  }, [
    keepersEnabled,
    playersLoading,
    workspace,
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
