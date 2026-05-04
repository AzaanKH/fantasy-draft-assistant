/**
 * Sleeper Draft Integration Hook
 *
 * Polls the Sleeper API for live draft picks and syncs with local state.
 *
 * Usage:
 * 1. Start a draft on Sleeper
 * 2. Get the draft_id from the URL: sleeper.com/draft/nfl/{draft_id}
 * 3. Enter the draft_id in the app
 * 4. Picks will sync automatically every few seconds
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Player, Position } from '@fantasy-draft/shared';
import { useDraftStore } from '@/stores/draftStore';
import { usePlayerDataQuery } from './usePlayerData';

/**
 * Sleeper draft pick response
 */
interface SleeperPick {
  round: number;
  roster_id: number;
  player_id: string;
  picked_by: string;
  pick_no: number;
  metadata: {
    first_name: string;
    last_name: string;
    position: string;
    team: string;
    status: string;
  } | null;
  is_keeper: boolean | null;
  draft_slot: number;
  draft_id: string;
}

/**
 * Sleeper draft metadata
 */
interface SleeperDraft {
  draft_id: string;
  status: 'pre_draft' | 'drafting' | 'complete';
  type: 'snake' | 'linear' | 'auction';
  settings: {
    teams: number;
    rounds: number;
    pick_timer: number;
  };
  draft_order: Record<string, number> | null;
}

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

/**
 * Fetch draft metadata
 */
async function fetchDraft(draftId: string): Promise<SleeperDraft> {
  const response = await fetch(`${SLEEPER_API_BASE}/draft/${draftId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch draft: ${response.status}`);
  }
  return response.json() as Promise<SleeperDraft>;
}

/**
 * Fetch all picks in a draft
 */
async function fetchDraftPicks(draftId: string): Promise<SleeperPick[]> {
  const response = await fetch(`${SLEEPER_API_BASE}/draft/${draftId}/picks`);
  if (!response.ok) {
    throw new Error(`Failed to fetch picks: ${response.status}`);
  }
  return response.json() as Promise<SleeperPick[]>;
}

/**
 * Normalize position from Sleeper format
 */
function normalizePosition(pos: string): Position {
  const map: Record<string, Position> = {
    QB: 'QB',
    RB: 'RB',
    WR: 'WR',
    TE: 'TE',
    K: 'K',
    DEF: 'DEF',
    DST: 'DEF',
  };
  return map[pos] ?? 'RB';
}

/**
 * Hook to connect to a Sleeper draft
 */
export function useSleeperDraft(draftId: string | null) {
  const queryClient = useQueryClient();
  const { players } = usePlayerDataQuery();
  const processedPicksRef = useRef<Set<string>>(new Set());
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [lastSyncedPick, setLastSyncedPick] = useState<number>(0);

  const markPlayerDrafted = useDraftStore((state) => state.markPlayerDrafted);
  const addToMyRoster = useDraftStore((state) => state.addToMyRoster);
  const myPickPosition = useDraftStore((state) => state.config.myPickPosition);
  const setConfig = useDraftStore((state) => state.setConfig);
  const [myPicksCount, setMyPicksCount] = useState<number>(0);

  // Fetch draft metadata
  const draftQuery = useQuery({
    queryKey: ['sleeper-draft', draftId],
    queryFn: () => fetchDraft(draftId!),
    enabled: !!draftId,
    staleTime: 30000, // 30 seconds
  });

  // Update config when draft loads
  useEffect(() => {
    if (draftQuery.data) {
      setConfig({
        totalTeams: draftQuery.data.settings.teams,
        totalRounds: draftQuery.data.settings.rounds,
      });
    }
  }, [draftQuery.data, setConfig]);

  // Fetch picks with polling
  const picksQuery = useQuery({
    queryKey: ['sleeper-draft-picks', draftId],
    queryFn: () => fetchDraftPicks(draftId!),
    enabled: !!draftId && (draftQuery.data?.status === 'drafting' || draftQuery.data?.status === 'complete'),
    refetchInterval: draftQuery.data?.status === 'drafting' ? 3000 : false, // Poll only during live draft
    staleTime: 1000,
  });

  // Match Sleeper player to our player data
  const findMatchingPlayer = useCallback(
    (pick: SleeperPick): Player | undefined => {
      // First try matching by Sleeper player_id
      const byId = players.find((p) => p.id === pick.player_id);
      if (byId) return byId;

      // Fall back to name + team matching
      if (pick.metadata) {
        const fullName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
        const byName = players.find(
          (p) =>
            p.name.toLowerCase() === fullName.toLowerCase() &&
            p.team === pick.metadata?.team
        );
        if (byName) return byName;
      }

      return undefined;
    },
    [players]
  );

  // Process new picks
  useEffect(() => {
    if (!picksQuery.data || players.length === 0) return;

    setSyncStatus('syncing');
    let newPicksProcessed = 0;
    let myPicks = 0;

    for (const pick of picksQuery.data) {
      const pickKey = `${pick.draft_id}-${pick.pick_no}`;

      // Count user's picks (even if already processed, for accurate count)
      if (pick.draft_slot === myPickPosition) {
        myPicks++;
      }

      // Skip already processed picks
      if (processedPicksRef.current.has(pickKey)) continue;

      const matchedPlayer = findMatchingPlayer(pick);
      const playerName = matchedPlayer?.name ??
        (pick.metadata ? `${pick.metadata.first_name} ${pick.metadata.last_name}` : 'Unknown');
      const position = matchedPlayer?.position ??
        (pick.metadata ? normalizePosition(pick.metadata.position) : 'RB');

      // Check if this is the user's pick
      const isMyPick = pick.draft_slot === myPickPosition;

      // Mark as drafted
      markPlayerDrafted(
        matchedPlayer?.id ?? pick.player_id,
        playerName,
        position,
        pick.draft_slot - 1,
        isMyPick ? 'My Team' : `Team ${pick.draft_slot}`,
        pick.pick_no
      );

      // Add to user's roster if it's their pick
      if (isMyPick && matchedPlayer) {
        addToMyRoster(matchedPlayer);
      }

      processedPicksRef.current.add(pickKey);
      newPicksProcessed++;
      setLastSyncedPick(pick.pick_no);
    }

    setMyPicksCount(myPicks);

    if (newPicksProcessed > 0) {
      console.log(`[Sleeper Sync] Processed ${newPicksProcessed} new picks (${myPicks} are yours)`);
    }

    setSyncStatus('synced');
  }, [picksQuery.data, players, findMatchingPlayer, markPlayerDrafted, addToMyRoster, myPickPosition]);

  // Manual refresh
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sleeper-draft-picks', draftId] });
  }, [queryClient, draftId]);

  // Reset when draft changes
  useEffect(() => {
    processedPicksRef.current = new Set();
    setLastSyncedPick(0);
    setMyPicksCount(0);
    setSyncStatus('idle');
  }, [draftId]);

  return {
    draft: draftQuery.data,
    picks: picksQuery.data ?? [],
    isLoading: draftQuery.isLoading || picksQuery.isLoading,
    isError: draftQuery.isError || picksQuery.isError,
    error: draftQuery.error ?? picksQuery.error,
    syncStatus,
    lastSyncedPick,
    totalPicks: picksQuery.data?.length ?? 0,
    myPicksCount,
    refresh,
    isDrafting: draftQuery.data?.status === 'drafting',
    isComplete: draftQuery.data?.status === 'complete',
  };
}
