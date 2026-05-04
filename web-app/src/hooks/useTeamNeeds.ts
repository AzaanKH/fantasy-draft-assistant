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
import { DEFAULT_ROSTER_REQUIREMENTS } from '@fantasy-draft/shared';
import {
  calculateAllScarcityScores,
  calculateTeamNeeds,
  getCriticalPositions,
} from '@/lib/calculations';
import { usePlayerDataQuery } from './usePlayerData';
import { useDraftStore } from '@/stores/draftStore';

/**
 * Hook to calculate positional scarcity scores
 * Based on how many elite players remain at each position
 */
export function useScarcityScores(): Map<Position, number> {
  const { players } = usePlayerDataQuery();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);

  return useMemo(() => {
    // Filter to only available (non-drafted) players
    const availablePlayers = players.filter((p) => !draftedPlayerIds.has(p.id));
    return calculateAllScarcityScores(availablePlayers);
  }, [players, draftedPlayerIds]);
}

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

  const scarcityScores = useMemo(() => {
    const availablePlayers = players.filter((p) => !draftedPlayerIds.has(p.id));
    return calculateAllScarcityScores(availablePlayers);
  }, [players, draftedPlayerIds]);

  const needs = useMemo(() => {
    return calculateTeamNeeds(myRoster, DEFAULT_ROSTER_REQUIREMENTS, scarcityScores);
  }, [myRoster, scarcityScores]);

  const criticalPositions = useMemo(() => {
    return getCriticalPositions(needs);
  }, [needs]);

  return {
    needs,
    criticalPositions,
    isLoading,
  };
}

/**
 * Hook to check if a specific position is a need for the team
 */
export function useIsPositionNeed(position: Position): boolean {
  const { needs } = useTeamNeeds();

  return useMemo(() => {
    const need = needs.find((n) => n.position === position);
    return (
      need !== undefined &&
      need.priority !== 'low' &&
      need.priority !== 'filled'
    );
  }, [needs, position]);
}
