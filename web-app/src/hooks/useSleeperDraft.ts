/**
 * Sleeper Draft Integration Hook
 *
 * Consumes canonical draft sync state from the local sync server.
 * The server polls Sleeper, stores the latest snapshot, and pushes
 * updates to the app over SSE.
 */

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DraftSyncSnapshot,
  DraftSyncUpdate,
  DraftPickEvent,
  Player,
  Position,
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

function normalizePosition(pos: string): Position {
  const map: Record<string, Position> = {
    QB: 'QB',
    RB: 'RB',
    WR: 'WR',
    TE: 'TE',
    K: 'K',
    DEF: 'DEF',
    DST: 'DEF',
    'D/ST': 'DEF',
  };
  return map[pos] ?? 'RB';
}

export function useSleeperDraft(draftId: string | null) {
  const queryClient = useQueryClient();
  const { players } = usePlayerDataQuery();
  const [liveSnapshot, setLiveSnapshot] = useState<DraftSyncSnapshot | null>(null);
  const processedPicksRef = useRef<Set<string>>(new Set());

  const markPlayerDrafted = useDraftStore((state) => state.markPlayerDrafted);
  const addToMyRoster = useDraftStore((state) => state.addToMyRoster);
  const myPickPosition = useDraftStore((state) => state.config.myPickPosition);
  const setConfig = useDraftStore((state) => state.setConfig);

  const snapshotQuery = useQuery({
    queryKey: ['sleeper-sync-snapshot', draftId],
    queryFn: () => fetchDraftSnapshot(draftId!),
    enabled: Boolean(draftId),
    staleTime: 1000,
  });

  useEffect(() => {
    if (!draftId) {
      setLiveSnapshot(null);
      return;
    }

    const eventSource = new EventSource(`/api/sync/drafts/${draftId}/events`);

    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data) as DraftSyncUpdate;
      setLiveSnapshot(update.snapshot);
      queryClient.setQueryData(['sleeper-sync-snapshot', draftId], update.snapshot);
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [draftId, queryClient]);

  const snapshot = liveSnapshot ?? snapshotQuery.data ?? null;

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
    if (!snapshot || players.length === 0) {
      return;
    }

    for (const pick of snapshot.picks) {
      const pickKey = `${pick.draftId}-${pick.pickNumber}`;
      if (processedPicksRef.current.has(pickKey)) {
        continue;
      }

      const matchedPlayer = findMatchingPlayer(pick);
      const isMyPick = pick.draftSlot === myPickPosition;
      const position = matchedPlayer?.position ?? normalizePosition(pick.position);
      const playerName = matchedPlayer?.name ?? pick.playerName;

      markPlayerDrafted(
        matchedPlayer?.id ?? pick.playerId,
        playerName,
        position,
        pick.teamIndex,
        isMyPick ? 'My Team' : `Team ${pick.draftSlot}`,
        pick.pickNumber
      );

      if (isMyPick && matchedPlayer) {
        addToMyRoster(matchedPlayer);
      }

      processedPicksRef.current.add(pickKey);
    }
  }, [snapshot, players, findMatchingPlayer, myPickPosition, markPlayerDrafted, addToMyRoster]);

  const refresh = useCallback(async () => {
    if (!draftId) {
      return;
    }

    const refreshedSnapshot = await requestRefresh(draftId);
    setLiveSnapshot(refreshedSnapshot);
    queryClient.setQueryData(['sleeper-sync-snapshot', draftId], refreshedSnapshot);
  }, [draftId, queryClient]);

  useEffect(() => {
    processedPicksRef.current = new Set();
  }, [draftId]);

  const myPicksCount = useMemo(() => {
    if (!snapshot) {
      return 0;
    }

    return snapshot.picks.filter((pick) => pick.draftSlot === myPickPosition).length;
  }, [snapshot, myPickPosition]);

  return {
    draft: snapshot?.draft ?? null,
    picks: snapshot?.picks ?? [],
    isLoading: snapshotQuery.isLoading && !snapshot,
    isError: snapshotQuery.isError,
    error: snapshotQuery.error,
    syncStatus: snapshot?.status ?? 'idle',
    lastSyncedPick: snapshot?.picks.at(-1)?.pickNumber ?? 0,
    totalPicks: snapshot?.picks.length ?? 0,
    myPicksCount,
    refresh,
    isDrafting: snapshot?.draft?.status === 'drafting',
    isComplete: snapshot?.draft?.status === 'complete',
  };
}
