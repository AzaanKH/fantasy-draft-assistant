import { useDraftView } from '@/workspace/useDraftView';
/**
 * Recommendations Hook
 *
 * Generates player recommendations based on:
 * - Best available by ECR ranking
 * - Team needs and positional scarcity
 * - TE premium scoring consideration
 */

import { DRAFT_DISPLAY } from '@/lib/demo-mode';
import { useMemo } from 'react';
import {
  POSITIONS,
  type Position,
} from '@fantasy-draft/shared/league';
import {
  type Recommendation,
} from '@fantasy-draft/shared/draft';
import {
  applyLeagueSurvivalModel,
  getRecommendationBoard,
  type RecommendationContext,
  type RecommendationResult,
  type RecommendationSelection,
} from '@fantasy-draft/shared/draft';
import { useLeagueTimingEvidence } from './useLeagueTimingEvidence';
import { usePlayerDataQuery } from './usePlayerData';
import { useTeamNeeds } from './useTeamNeeds';
import { useDraftStore } from '@/stores/draftStore';

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

/**
 * Hook to get player recommendations
 *
 * @param limit - Maximum number of recommendations per list (default: 5)
 * @returns Object with bestAvailable and byNeed recommendation arrays
 */
interface PositionRecommendationDecision {
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
  const { players, isLoading: playersLoading } = usePlayerDataQuery();
  const { needs, isLoading: needsLoading } = useTeamNeeds();
  const available = useDraftView((view) => view.available);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftView((state) => state.currentPick);
  const myRoster = useDraftView((state) => state.myRoster);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const mockSurvivalProbabilities = useDraftStore(
    (state) => state.mockSurvivalProbabilities
  );
  const isMyTurn = useDraftView((view) => view.isMyTurn);
  const rosterSize = useMemo(
    () => POSITIONS.map(position => myRoster[position]).reduce(
      (total, playerIds) => total + playerIds.length,
      0
    ),
    [myRoster]
  );
  const rosterPlayers = useMemo(() => {
    const playersById = new Map(players.map((player) => [player.id, player]));
    return POSITIONS.map(position => myRoster[position]).flatMap((ids) =>
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
  const timingEvidence = useLeagueTimingEvidence(enabled);

  const availablePlayers = useMemo(() => {
    if (!enabled) return [];
    const leagueAdjustedPool = applyLeagueSurvivalModel([...available], timingEvidence.model, {
      currentPick,
      myPickPosition: config.myPickPosition,
      totalTeams: config.totalTeams,
      totalRounds: config.totalRounds,
      draftType: config.draftType,
    });
    const leagueAdjusted = leagueAdjustedPool;
    if (sessionMode !== 'mock' || !timingEvidence.model) return leagueAdjusted;
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
  }, [enabled, available, timingEvidence.model, currentPick, config.myPickPosition, config.totalTeams, config.totalRounds, config.draftType, mockSurvivalProbabilities, sessionMode]);

  const recommendationContext = useMemo<RecommendationContext>(() => ({
      currentPick,
      totalPicks: config.totalTeams * config.totalRounds,
      totalTeams: config.totalTeams,
      isMyTurn,
      requirements: config.rosterRequirements,
      rosterPlayers,
      selectionsRemaining: Math.max(0, config.totalRounds - rosterSize),
      rosterCounts: {
        QB: myRoster.QB.length,
        RB: myRoster.RB.length,
        WR: myRoster.WR.length,
        TE: myRoster.TE.length,
        K: myRoster.K.length,
        DEF: myRoster.DEF.length,
      },
  }), [currentPick, config.totalTeams, config.totalRounds, config.rosterRequirements, isMyTurn, myRoster, rosterPlayers, rosterSize]);

  const recommendationsEnabled = enabled && hasRemainingDraftDecision(
    currentPick,
    config.totalTeams * config.totalRounds,
    rosterSize,
    config.totalRounds
  );

  const { recommendations, positionRecommendationStates } = useMemo(() => {
    const decisions = {} as Record<Position, PositionRecommendationDecision>;
    if (!recommendationsEnabled) {
      for (const position of POSITIONS) {
        decisions[position] = {
          recommendations: [],
          bestAvailable: [],
          selection: EMPTY_SELECTION,
        };
      }
      return {
        recommendations: EMPTY_RECOMMENDATIONS,
        positionRecommendationStates: decisions,
      };
    }
    const board = getRecommendationBoard(
      availablePlayers,
      needs,
      limit,
      recommendationContext,
      DRAFT_DISPLAY
    );
    for (const position of POSITIONS) {
      const result = board.byPosition[position];
      decisions[position] = {
        recommendations: result.draftNow,
        bestAvailable: result.bestAvailable,
        selection: result.selection,
      };
    }
    return {
      recommendations: board.overall,
      positionRecommendationStates: decisions,
    };
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
      playersLoading || needsLoading || timingEvidence.isLoading
    ),
  };
}
