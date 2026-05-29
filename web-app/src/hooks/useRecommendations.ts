/**
 * Recommendations Hook
 *
 * Generates player recommendations based on:
 * - Best available by ECR ranking
 * - Team needs and positional scarcity
 * - TE premium scoring consideration
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Recommendation } from '@fantasy-draft/shared';
import {
  applyLeagueSurvivalModel,
  getRecommendations,
  getTopRecommendation,
  type LeagueSurvivalModel,
} from '@/lib/calculations';
import { usePlayerDataQuery } from './usePlayerData';
import { useTeamNeeds } from './useTeamNeeds';
import { useDraftStore } from '@/stores/draftStore';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLeagueSurvivalPositionSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['position'] === 'string' &&
    isNumber(value['leagueMedianPick']) &&
    isNumber(value['sleeperMedianPick']) &&
    isNumber(value['pickPremium']) &&
    isNumber(value['top50RateDelta']) &&
    isNumber(value['top100RateDelta']) &&
    isNumber(value['sampleSize'])
  );
}

function isLeagueSurvivalModel(value: unknown): value is LeagueSurvivalModel {
  if (
    !isRecord(value) ||
    typeof value['generatedAt'] !== 'string' ||
    typeof value['modelVersion'] !== 'string' ||
    typeof value['leagueName'] !== 'string' ||
    !Array.isArray(value['seasons']) ||
    !value['seasons'].every(isNumber) ||
    !isNumber(value['sampleSize']) ||
    !isRecord(value['positions'])
  ) {
    return false;
  }

  const positions = value['positions'];
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].every((position) =>
    isLeagueSurvivalPositionSummary(positions[position])
  );
}

async function fetchLeagueSurvivalModel(): Promise<LeagueSurvivalModel | null> {
  const response = await fetch('/data/league-history/survival-model.json');
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load league survival model: ${String(response.status)}`);
  }
  const parsed = await response.json() as unknown;
  if (!isLeagueSurvivalModel(parsed)) {
    throw new Error('Invalid league survival model shape from /data/league-history/survival-model.json');
  }
  return parsed;
}

/**
 * Hook to get player recommendations
 *
 * @param limit - Maximum number of recommendations per list (default: 5)
 * @returns Object with bestAvailable and byNeed recommendation arrays
 */
export function useRecommendations(limit: number = 5): {
  draftNow: readonly Recommendation[];
  bestAvailable: readonly Recommendation[];
  byNeed: readonly Recommendation[];
  topPick: Recommendation | null;
  isLoading: boolean;
} {
  const { players, isLoading: playersLoading } = usePlayerDataQuery();
  const { needs, isLoading: needsLoading } = useTeamNeeds();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const isMyTurn = useDraftStore((state) => state.isMyTurn);
  const survivalModelQuery = useQuery({
    queryKey: ['league-survival-model'],
    queryFn: fetchLeagueSurvivalModel,
    staleTime: Infinity,
  });

  const availablePlayers = useMemo(() => {
    const available = players.filter((p) => !draftedPlayerIds.has(p.id));
    return applyLeagueSurvivalModel(available, survivalModelQuery.data, {
      currentPick,
      myPickPosition: config.myPickPosition,
      totalTeams: config.totalTeams,
      totalRounds: config.totalRounds,
    });
  }, [players, draftedPlayerIds, survivalModelQuery.data, currentPick, config.myPickPosition, config.totalTeams, config.totalRounds]);

  const recommendations = useMemo(() => {
    if (availablePlayers.length === 0) {
      return { draftNow: [], bestAvailable: [], byNeed: [] };
    }
    return getRecommendations(availablePlayers, needs, limit, {
      currentPick,
      totalPicks: config.totalTeams * config.totalRounds,
      isMyTurn,
    });
  }, [availablePlayers, needs, limit, currentPick, config.totalTeams, config.totalRounds, isMyTurn]);

  const topPick = useMemo(() => {
    if (availablePlayers.length === 0) {
      return null;
    }
    return getTopRecommendation(availablePlayers, needs, {
      currentPick,
      totalPicks: config.totalTeams * config.totalRounds,
      isMyTurn,
    });
  }, [availablePlayers, needs, currentPick, config.totalTeams, config.totalRounds, isMyTurn]);

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
      reason: `ECR #${String(player.ecrRank)}`,
      score: 100 - player.ecrRank,
    }));
  }, [players, position, draftedPlayerIds, limit]);

  return {
    recommendations,
    isLoading,
  };
}
