import { useMemo } from 'react';
import type { Player } from '@fantasy-draft/shared';
import { filterDrafted } from '@/lib/calculations';
import { getEffectiveKeeperAssignments } from '@/lib/keeper-supply';
import { useDraftStore } from '@/stores/draftStore';
import { usePlayerDataQuery } from './usePlayerData';

/** Picks made so far plus keepers whose slots count as taken. */
export function useDraftedPlayers(): readonly { readonly playerName: string; readonly position: Player['position'] }[] {
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const draftType = useDraftStore((state) => state.config.draftType);
  return useMemo(() => [
    ...draftHistory,
    ...getEffectiveKeeperAssignments(preloadedKeepers, draftHistory, totalTeams, draftType),
  ], [draftHistory, draftType, preloadedKeepers, totalTeams]);
}

/**
 * The complete canonical pool minus drafted players and keepers. It does not depend on
 * readiness, so players stay browsable while recommendations are blocked.
 */
export function useUndraftedPlayers(): readonly Player[] {
  const { players } = usePlayerDataQuery();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const draftedPlayers = useDraftedPlayers();
  return useMemo(
    () => filterDrafted(players, draftedPlayerIds, draftedPlayers),
    [draftedPlayerIds, draftedPlayers, players]
  );
}
