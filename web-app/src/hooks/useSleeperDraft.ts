/**
 * Sleeper Draft Integration Hook
 *
 * Consumes canonical draft sync state from the local sync server.
 * The server polls Sleeper, stores the latest snapshot, and pushes
 * updates to the app over SSE.
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isDraftSyncUpdate, normalizePosition } from '@fantasy-draft/shared';
import type {
  DraftSyncSnapshot,
  DraftPickEvent,
  Player,
} from '@fantasy-draft/shared';
import { useDraftStore } from '@/stores/draftStore';
import { usePlayerDataQuery } from './usePlayerData';

async function fetchDraftSnapshot(draftId: string): Promise<DraftSyncSnapshot> {
  const response = await fetch(`/api/sync/drafts/${draftId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch draft snapshot: ${response.status}`);
  }

  return response.json() as Promise<DraftSyncSnapshot>;
}

async function requestRefresh(draftId: string): Promise<DraftSyncSnapshot> {
  const response = await fetch(`/api/sync/drafts/${draftId}/refresh`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to refresh draft snapshot: ${response.status}`);
  }

  return response.json() as Promise<DraftSyncSnapshot>;
}

export function useSleeperDraft(
  draftId: string | null,
  shouldImportPicks: boolean = true
) {
  const queryClient = useQueryClient();
  const { players } = usePlayerDataQuery();
  const [liveSnapshot, setLiveSnapshot] = useState<DraftSyncSnapshot | null>(null);
  const reconcileSleeperPicks = useDraftStore((state) => state.reconcileSleeperPicks);
  const myPickPosition = useDraftStore((state) => state.config.myPickPosition);
  const setConfig = useDraftStore((state) => state.setConfig);

  const snapshotQuery = useQuery({
    queryKey: ['sleeper-sync-snapshot', draftId],
    queryFn: async () => {
      if (!draftId) {
        throw new Error('A draft ID is required to fetch a Sleeper snapshot');
      }
      return fetchDraftSnapshot(draftId);
    },
    enabled: Boolean(draftId),
    staleTime: 1000,
  });

  useEffect(() => {
    if (!draftId) {
      setLiveSnapshot(null);
      return;
    }

    const eventSource = new EventSource(`/api/sync/drafts/${draftId}/events`);

    eventSource.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (!isDraftSyncUpdate(parsed)) {
          return;
        }
        const update = parsed;
        setLiveSnapshot(update.snapshot);
        queryClient.setQueryData(['sleeper-sync-snapshot', draftId], update.snapshot);
      } catch {
        // Ignore a malformed event; EventSource remains connected and can
        // recover on the next canonical snapshot.
      }
    };

    // Do not close here: EventSource automatically reconnects after transient
    // network/server failures.
    eventSource.onerror = () => undefined;

    return () => {
      eventSource.close();
    };
  }, [draftId, queryClient]);

  const snapshot =
    liveSnapshot?.draftId === draftId ? liveSnapshot : snapshotQuery.data ?? null;

  useEffect(() => {
    if (!snapshot?.draft) {
      return;
    }

    setConfig({
      totalTeams: snapshot.draft.settings.teams,
      totalRounds: snapshot.draft.settings.rounds,
    });
  }, [setConfig, snapshot?.draft]);

  const playerIndexes = useMemo(() => {
    const byId = new Map<string, Player>();
    const byNameTeam = new Map<string, Player>();

    for (const player of players) {
      byId.set(player.id, player);
      byNameTeam.set(`${player.name.toLowerCase()}|${player.team}`, player);
    }

    return { byId, byNameTeam };
  }, [players]);

  const findMatchingPlayer = useCallback(
    (pick: DraftPickEvent): Player | undefined => {
      const byId = playerIndexes.byId.get(pick.playerId);
      if (byId) {
        return byId;
      }

      if (pick.nflTeam) {
        return playerIndexes.byNameTeam.get(
          `${pick.playerName.toLowerCase()}|${pick.nflTeam}`
        );
      }

      return undefined;
    },
    [playerIndexes]
  );

  useEffect(() => {
    if (!snapshot || players.length === 0 || !shouldImportPicks) {
      return;
    }

    reconcileSleeperPicks(snapshot.picks.flatMap((pick) => {
      const matchedPlayer = findMatchingPlayer(pick);
      const isMyPick = pick.draftSlot === myPickPosition;
      const position = matchedPlayer?.position ?? normalizePosition(pick.position ?? undefined);
      if (!position) {
        return [];
      }
      const playerName = matchedPlayer?.name ?? pick.playerName;

      return [{
        pickNumber: pick.pickNumber,
        playerId: matchedPlayer?.id ?? pick.playerId,
        playerName,
        position,
        teamIndex: pick.teamIndex,
        teamName: isMyPick ? 'My Team' : `Team ${String(pick.draftSlot)}`,
        isMyPick,
      }];
    }));
  }, [snapshot, players, shouldImportPicks, findMatchingPlayer, myPickPosition, reconcileSleeperPicks]);

  const refresh = useCallback(async () => {
    if (!draftId) {
      return;
    }

    const refreshedSnapshot = await requestRefresh(draftId);
    setLiveSnapshot(refreshedSnapshot);
    queryClient.setQueryData(['sleeper-sync-snapshot', draftId], refreshedSnapshot);
  }, [draftId, queryClient]);

  const myPicksCount = useMemo(() => {
    if (!snapshot) {
      return 0;
    }

    return snapshot.picks.filter((pick) => pick.draftSlot === myPickPosition).length;
  }, [snapshot, myPickPosition]);

  const lastError = snapshot?.lastError ?? snapshotQuery.error?.message ?? null;
  const error = snapshot?.lastError
    ? new Error(snapshot.lastError)
    : snapshotQuery.error;

  return {
    draft: snapshot?.draft ?? null,
    picks: snapshot?.picks ?? [],
    isLoading: snapshotQuery.isLoading && !snapshot,
    isError: snapshotQuery.isError || snapshot?.status === 'error',
    error,
    lastError,
    syncStatus: snapshot?.status ?? 'idle',
    lastSyncedPick: snapshot?.picks.at(-1)?.pickNumber ?? 0,
    totalPicks: snapshot?.picks.length ?? 0,
    myPicksCount,
    refresh,
    isDrafting: snapshot?.draft?.status === 'drafting',
    isComplete: snapshot?.draft?.status === 'complete',
  };
}
