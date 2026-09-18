/**
 * Team Needs Hook
 *
 * Calculates positional scarcity and team needs based on:
 * - Current roster state
 * - Available players in the draft
 * - League roster requirements
 */

import { useMemo } from 'react';
import type { Position, PositionNeed } from '@fantasy-draft/shared';
import {
  calculateAllScarcityScores,
  calculateTeamNeeds,
  getCriticalPositions,
} from '@/lib/calculations';
import { usePlayerDataQuery } from './usePlayerData';
import { useDraftStore } from '@/stores/draftStore';

/**
 * Hook to calculate team positional needs
 * Returns prioritized list of positions the team needs to fill
 */
export function useTeamNeeds(): {
  needs: PositionNeed[];
  criticalPositions: Position[];
  isLoading: boolean;
} {
  const { players, isLoading } = usePlayerDataQuery();
  const myRoster = useDraftStore((state) => state.myRoster);
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const currentPick = useDraftStore((state) => state.currentPick);
  const config = useDraftStore((state) => state.config);

  const scarcityScores = useMemo(() => {
    const availablePlayers = players.filter((p) => !draftedPlayerIds.has(p.id));
    return calculateAllScarcityScores(availablePlayers);
  }, [players, draftedPlayerIds]);

  const needs = useMemo(() => {
    return calculateTeamNeeds(myRoster, config.rosterRequirements, scarcityScores, {
      currentPick,
      totalPicks: config.totalTeams * config.totalRounds,
      totalRounds: config.totalRounds,
    });
  }, [myRoster, scarcityScores, currentPick, config.totalTeams, config.totalRounds, config.rosterRequirements]);

  const criticalPositions = useMemo(() => {
    return getCriticalPositions(needs);
  }, [needs]);

  return {
    needs,
    criticalPositions,
    isLoading,
  };
}
