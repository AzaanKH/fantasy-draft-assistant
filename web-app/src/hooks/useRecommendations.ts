/**
 * Recommendations Hook
 *
 * Generates player recommendations based on:
 * - Best available by ECR ranking
 * - Team needs and positional scarcity
 * - TE premium scoring consideration
 */

import { useMemo } from 'react';
import type { Recommendation } from '@fantasy-draft/shared';
import { getRecommendations, getTopRecommendation } from '@/lib/calculations';
import { usePlayerDataQuery } from './usePlayerData';
import { useTeamNeeds } from './useTeamNeeds';
import { useDraftStore } from '@/stores/draftStore';

/**
 * Hook to get player recommendations
 *
 * @param limit - Maximum number of recommendations per list (default: 5)
 * @returns Object with bestAvailable and byNeed recommendation arrays
 */
export function useRecommendations(limit: number = 5): {
  bestAvailable: readonly Recommendation[];
  byNeed: readonly Recommendation[];
  topPick: Recommendation | null;
  isLoading: boolean;
} {
  const { players, isLoading: playersLoading } = usePlayerDataQuery();
  const { needs, isLoading: needsLoading } = useTeamNeeds();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);

  const availablePlayers = useMemo(() => {
    return players.filter((p) => !draftedPlayerIds.has(p.id));
  }, [players, draftedPlayerIds]);

  const recommendations = useMemo(() => {
    if (availablePlayers.length === 0) {
      return { bestAvailable: [], byNeed: [] };
    }
    return getRecommendations(availablePlayers, needs, limit);
  }, [availablePlayers, needs, limit]);

  const topPick = useMemo(() => {
    if (availablePlayers.length === 0) {
      return null;
    }
    return getTopRecommendation(availablePlayers, needs);
  }, [availablePlayers, needs]);

  return {
    ...recommendations,
    topPick,
    isLoading: playersLoading || needsLoading,
  };
}

/**
 * Hook to get the single best recommendation for the current situation
 */
export function useTopRecommendation(): {
  recommendation: Recommendation | null;
  isLoading: boolean;
} {
  const { topPick, isLoading } = useRecommendations(1);
  return {
    recommendation: topPick,
    isLoading,
  };
}

/**
 * Hook to get best available players at a specific position
 *
 * @param position - Position to filter by
 * @param limit - Maximum number of recommendations (default: 5)
 */
export function usePositionRecommendations(
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF',
  limit: number = 5
): {
  recommendations: Recommendation[];
  isLoading: boolean;
} {
  const { players, isLoading } = usePlayerDataQuery();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);

  const recommendations = useMemo(() => {
    const available = players
      .filter((p) => p.position === position && !draftedPlayerIds.has(p.id))
      .sort((a, b) => a.ecrRank - b.ecrRank)
      .slice(0, limit);

    return available.map((player) => ({
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      reason: `ECR #${player.ecrRank}`,
      score: 100 - player.ecrRank,
    }));
  }, [players, position, draftedPlayerIds, limit]);

  return {
    recommendations,
    isLoading,
  };
}
