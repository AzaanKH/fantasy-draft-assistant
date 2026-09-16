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
import {
  POSITIONS,
  type Player,
  type Position,
  type Recommendation,
} from '@fantasy-draft/shared';
import {
  applyLeagueSurvivalModel,
  filterDrafted,
  getRecommendations,
  type LeagueSurvivalModel,
  type RecommendationContext,
  type RecommendationResult,
  type RecommendationSelection,
} from '@/lib/calculations';
import { usePlayerDataQuery } from './usePlayerData';
import { useTeamNeeds } from './useTeamNeeds';
import { useDraftStore, useIsMyTurn } from '@/stores/draftStore';
import { getEffectiveKeeperAssignments } from '@/lib/keeper-supply';

const EMPTY_SELECTION: RecommendationSelection = {
  policy: 'league-aware-score',
};

const EMPTY_RECOMMENDATIONS: RecommendationResult = {
  draftNow: [],
  rbIntentionalReaches: [],
  bestAvailable: [],
  marketValues: [],
  marketStashes: [],
  byNeed: [],
  selection: EMPTY_SELECTION,
};

/** Recommendations stop once the manager has no selection left to make. */
export function hasRemainingDraftDecision(
  currentPick: number,
  totalPicks: number,
  rosterSize: number,
  totalRounds: number
): boolean {
  return currentPick <= totalPicks && rosterSize < totalRounds;
}

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
  const historicalPickNumbers = value['historicalPickNumbers'];
  return POSITIONS.every((position) =>
    isLeagueSurvivalPositionSummary(positions[position])
  ) && (
    historicalPickNumbers === undefined ||
    (
      isRecord(historicalPickNumbers) &&
      POSITIONS.every((position) =>
        Array.isArray(historicalPickNumbers[position]) &&
        historicalPickNumbers[position].every(isNumber)
      )
    )
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
export interface PositionRecommendationDecision {
  readonly recommendations: readonly Recommendation[];
  readonly bestAvailable: readonly Recommendation[];
  readonly selection: RecommendationSelection;
}

export function useRecommendations(limit: number = 5, enabled: boolean = true): {
  draftNow: readonly Recommendation[];
  rbIntentionalReaches: readonly Recommendation[];
  bestAvailable: readonly Recommendation[];
  marketValues: readonly Recommendation[];
  marketStashes: readonly Recommendation[];
  byNeed: readonly Recommendation[];
  selection: RecommendationSelection;
  positionRecommendationStates: Readonly<Record<Position, PositionRecommendationDecision>>;
  topPick: Recommendation | null;
  isLoading: boolean;
} {
  const { players, isLoading: playersLoading, dataInfo } = usePlayerDataQuery();
  const { needs, isLoading: needsLoading } = useTeamNeeds();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const config = useDraftStore((state) => state.config);
  const effectiveKeepers = useMemo(
    () => getEffectiveKeeperAssignments(
      preloadedKeepers,
      draftHistory,
      config.totalTeams
    ),
    [config.totalTeams, draftHistory, preloadedKeepers]
  );
  const draftedPlayers = useMemo(
    () => [...draftHistory, ...effectiveKeepers],
    [draftHistory, effectiveKeepers]
  );
  const currentPick = useDraftStore((state) => state.currentPick);
  const myRoster = useDraftStore((state) => state.myRoster);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const mockSurvivalProbabilities = useDraftStore(
    (state) => state.mockSurvivalProbabilities
  );
  const isMyTurn = useIsMyTurn();
  const rosterSize = useMemo(
    () => (Object.values(myRoster) as string[][]).reduce(
      (total, playerIds) => total + playerIds.length,
      0
    ),
    [myRoster]
  );
  const rosterPlayers = useMemo(() => {
    const playersById = new Map(players.map((player) => [player.id, player]));
    return (Object.values(myRoster) as string[][]).flatMap((ids) =>
      ids.flatMap((id: string) => {
        const player = playersById.get(id);
        return player
          ? [{
              id: player.id,
              position: player.position,
              projectedPoints: player.projectedPoints,
              ceilingScore: player.ceilingScore,
            }]
          : [];
      })
    );
  }, [myRoster, players]);
  const survivalModelQuery = useQuery({
    queryKey: ['league-survival-model'],
    queryFn: fetchLeagueSurvivalModel,
    staleTime: Infinity,
  });

  const availablePlayers = useMemo(() => {
    if (!enabled) return [];
    const leagueAdjustedPool = applyLeagueSurvivalModel(players, survivalModelQuery.data, {
      currentPick,
      myPickPosition: config.myPickPosition,
      totalTeams: config.totalTeams,
      totalRounds: config.totalRounds,
    });
    const leagueAdjusted = filterDrafted(
      leagueAdjustedPool,
      draftedPlayerIds,
      draftedPlayers
    );
    if (sessionMode !== 'mock') return leagueAdjusted;
    return leagueAdjusted.map((player) => {
      const mockProbability = mockSurvivalProbabilities[player.id];
      return mockProbability === undefined
        ? player
        : {
            ...player,
            nextPickSurvivalProbability: mockProbability,
            survivalModelSource: 'league-history' as const,
          };
    });
  }, [enabled, players, draftedPlayerIds, draftedPlayers, survivalModelQuery.data, currentPick, config.myPickPosition, config.totalTeams, config.totalRounds, mockSurvivalProbabilities, sessionMode]);

  const recommendationContext = useMemo<RecommendationContext>(() => ({
      currentPick,
      totalPicks: config.totalTeams * config.totalRounds,
      totalTeams: config.totalTeams,
      isMyTurn,
      architecture: 'best-pick-policy',
      requirements: config.rosterRequirements,
      rosterPlayers,
      selectionsRemaining: Math.max(0, config.totalRounds - rosterSize),
      allowPickEvOverrides: dataInfo.pickEvOverrideEnabled,
      pickEvOverrideThreshold: dataInfo.pickEvOverrideThreshold,
      rosterCounts: {
        QB: myRoster.QB.length,
        RB: myRoster.RB.length,
        WR: myRoster.WR.length,
        TE: myRoster.TE.length,
        K: myRoster.K.length,
        DEF: myRoster.DEF.length,
      },
  }), [currentPick, config.totalTeams, config.totalRounds, config.rosterRequirements, isMyTurn, myRoster, rosterPlayers, rosterSize, dataInfo.pickEvOverrideEnabled, dataInfo.pickEvOverrideThreshold]);

  const recommendationsEnabled = enabled && hasRemainingDraftDecision(
    currentPick,
    config.totalTeams * config.totalRounds,
    rosterSize,
    config.totalRounds
  );

  const recommendations = useMemo(
    () => recommendationsEnabled
      ? getRecommendations(availablePlayers, needs, limit, recommendationContext)
      : EMPTY_RECOMMENDATIONS,
    [availablePlayers, recommendationsEnabled, needs, limit, recommendationContext]
  );

  const positionRecommendationStates = useMemo(() => {
    const decisions = {} as Record<Position, PositionRecommendationDecision>;
    POSITIONS.forEach((position) => {
      if (!recommendationsEnabled) {
        decisions[position] = {
          recommendations: [],
          bestAvailable: [],
          selection: EMPTY_SELECTION,
        };
        return;
      }
      const result = getRecommendations(
        availablePlayers.filter((player: Player) => player.position === position),
        needs,
        limit,
        recommendationContext
      );
      decisions[position] = {
        recommendations: result.draftNow,
        bestAvailable: result.bestAvailable,
        selection: result.selection,
      };
    });
    return decisions;
  }, [availablePlayers, recommendationsEnabled, needs, limit, recommendationContext]);

  const topPick = recommendations.draftNow[0]
    ?? recommendations.byNeed[0]
    ?? recommendations.bestAvailable[0]
    ?? null;

  return {
    ...recommendations,
    positionRecommendationStates,
    topPick,
    isLoading: enabled && (
      playersLoading || needsLoading || survivalModelQuery.isLoading
    ),
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
  recommendations: readonly Recommendation[];
  isLoading: boolean;
} {
  const { positionRecommendationStates, isLoading } = useRecommendations(limit);

  return {
    recommendations: positionRecommendationStates[position].recommendations,
    isLoading,
  };
}
