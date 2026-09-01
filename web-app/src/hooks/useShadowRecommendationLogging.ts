import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DraftProvider, Recommendation } from '@fantasy-draft/shared';
import {
  applyLeagueSurvivalModel,
  getRosterCapacity,
  getRecommendations,
  isLeagueSurvivalModel,
  type LeagueSurvivalModel,
} from '@/lib/calculations';
import {
  buildShadowRecommendationEvent,
  postShadowRecommendation,
} from '@/lib/shadow-recommendation';
import { useDraftStore, useIsMyTurn } from '@/stores/draftStore';
import { usePlayerDataQuery } from './usePlayerData';
import { useTeamNeeds } from './useTeamNeeds';

const MAX_SHADOW_POST_ATTEMPTS = 3;

async function fetchLeagueSurvivalModel(): Promise<LeagueSurvivalModel | null> {
  const response = await fetch('/data/league-history/survival-model.json');
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to load league survival model: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  return isLeagueSurvivalModel(parsed) ? parsed : null;
}

export interface ShadowRecommendationLoggingInput {
  readonly draftId: string | null;
  readonly draftProvider: DraftProvider | null;
  readonly draftReady: boolean;
  readonly coreBestPick: Recommendation | null;
  readonly coreBestPlayer: Recommendation | null;
  readonly coreRecommendations: readonly Recommendation[];
  readonly corePolicy: string;
}

export function useShadowRecommendationLogging(
  input: ShadowRecommendationLoggingInput
): void {
  const {
    draftId,
    draftProvider,
    draftReady,
    coreBestPick,
    coreBestPlayer,
    coreRecommendations,
    corePolicy,
  } = input;
  const { shadowPlayers, dataInfo } = usePlayerDataQuery();
  const { needs } = useTeamNeeds();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const myRoster = useDraftStore((state) => state.myRoster);
  const config = useDraftStore((state) => state.config);
  const leagueSettingsFingerprint = useDraftStore(
    (state) => state.leagueSettings.fingerprint
  );
  const currentPick = useDraftStore((state) => state.currentPick);
  const isMyTurn = useIsMyTurn();
  const attemptedEventIds = useRef(new Set<string>());
  const failedPostCounts = useRef(new Map<string, number>());
  const survivalModelQuery = useQuery({
    queryKey: ['league-survival-model'],
    queryFn: fetchLeagueSurvivalModel,
    staleTime: Infinity,
    enabled: dataInfo.shadowLoggingEnabled && draftReady,
  });
  const context = useMemo(() => ({
    currentPick,
    myPickPosition: config.myPickPosition,
    totalTeams: config.totalTeams,
    totalRounds: config.totalRounds,
  }), [config.myPickPosition, config.totalRounds, config.totalTeams, currentPick]);

  useEffect(() => {
    const attemptedIds = attemptedEventIds.current;
    const failureCounts = failedPostCounts.current;
    const endpoint = dataInfo.shadowLoggingEndpoint;
    const season = dataInfo.shadowLoggingSeason;
    const modelVersion = dataInfo.predictionModelVersion;
    const predictionGeneratedAt = dataInfo.predictionGeneratedAt;
    if (
      !draftReady ||
      !draftId ||
      !draftProvider ||
      !isMyTurn ||
      !dataInfo.shadowLoggingEnabled ||
      season !== 2026 ||
      !endpoint ||
      !modelVersion ||
      !predictionGeneratedAt ||
      !coreBestPick ||
      !coreBestPlayer ||
      coreRecommendations.length === 0 ||
      shadowPlayers.length === 0
    ) {
      return;
    }

    const eventId = `${String(season)}:${draftProvider}:${draftId}:${String(currentPick)}`;
    if (
      attemptedIds.has(eventId) ||
      (failureCounts.get(eventId) ?? 0) >= MAX_SHADOW_POST_ATTEMPTS
    ) {
      return;
    }
    attemptedIds.add(eventId);

    // Run the experiment after the core decision has committed. Shadow scoring
    // and network failures cannot hold up the recommendation under the clock.
    let started = false;
    const timeout = window.setTimeout(() => {
      started = true;
      try {
        const availableModel = applyLeagueSurvivalModel(
          shadowPlayers,
          survivalModelQuery.data,
          context
        ).filter((player) => !draftedPlayerIds.has(player.id));
        const playersById = new Map(
          shadowPlayers.map((player) => [player.id, player])
        );
        const rosterPlayers = (Object.values(myRoster) as string[][]).flatMap((ids) =>
          ids.flatMap((id) => {
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
        const shadowRecommendations = getRecommendations(
          availableModel,
          needs,
          5,
          {
            currentPick,
            totalPicks: config.totalTeams * config.totalRounds,
            totalTeams: config.totalTeams,
            isMyTurn,
            architecture: 'best-pick-policy',
            requirements: config.rosterRequirements,
            rosterPlayers,
            selectionsRemaining: Math.max(
              0,
              getRosterCapacity(config.rosterRequirements) - rosterPlayers.length
            ),
            rosterCounts: {
              QB: myRoster.QB.length,
              RB: myRoster.RB.length,
              WR: myRoster.WR.length,
              TE: myRoster.TE.length,
              K: myRoster.K.length,
              DEF: myRoster.DEF.length,
            },
          }
        ).draftNow;

        if (shadowRecommendations.length === 0) {
          attemptedIds.delete(eventId);
          failureCounts.delete(eventId);
          return;
        }

        const event = buildShadowRecommendationEvent({
          season,
          draftId,
          draftProvider,
          pickNumber: currentPick,
          observedAt: new Date().toISOString(),
          modelVersion,
          predictionGeneratedAt,
          corePolicy,
          coreBestPick,
          coreBestPlayer,
          coreRecommendations,
          shadowRecommendations,
          leagueSettingsFingerprint,
          totalTeams: config.totalTeams,
          totalRounds: config.totalRounds,
          myPickPosition: config.myPickPosition,
          draftedPlayerIds: [...draftedPlayerIds],
          rosterPlayerIds: Object.values(myRoster).flat(),
          positionNeeds: needs,
        });

        void postShadowRecommendation(endpoint, event).then((recorded) => {
          if (recorded) {
            failureCounts.delete(eventId);
            return;
          }

          const failures = (failureCounts.get(eventId) ?? 0) + 1;
          if (failures >= MAX_SHADOW_POST_ATTEMPTS) {
            failureCounts.delete(eventId);
            return;
          }
          failureCounts.set(eventId, failures);
          attemptedIds.delete(eventId);
        });
      } catch {
        attemptedIds.delete(eventId);
        failureCounts.delete(eventId);
      }
    }, 0);

    return () => {
      if (!started) {
        window.clearTimeout(timeout);
        attemptedIds.delete(eventId);
        failureCounts.delete(eventId);
      }
    };
  }, [config.myPickPosition, config.rosterRequirements, config.totalRounds, config.totalTeams, context, coreBestPick, coreBestPlayer, corePolicy, coreRecommendations, currentPick, dataInfo.predictionGeneratedAt, dataInfo.predictionModelVersion, dataInfo.shadowLoggingEnabled, dataInfo.shadowLoggingEndpoint, dataInfo.shadowLoggingSeason, draftId, draftProvider, draftReady, draftedPlayerIds, isMyTurn, leagueSettingsFingerprint, myRoster, needs, shadowPlayers, survivalModelQuery.data]);
}
