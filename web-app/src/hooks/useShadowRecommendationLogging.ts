import { useDraftState } from '@/workspace/WorkspaceProvider';
import { POSITIONS } from '@fantasy-draft/shared/league';
import { useDraftView } from '@/workspace/useDraftView';
import { DRAFT_DISPLAY } from '@/lib/demo-mode';
import { useEffect, useMemo, useRef } from 'react';
import { useLeagueTimingEvidence } from './useLeagueTimingEvidence';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import {
  applyLeagueSurvivalModel,
  getRecommendations,
} from '@fantasy-draft/shared/draft';
import {
  buildShadowRecommendationEvent,
  postShadowRecommendation,
} from '@/lib/shadow-recommendation';

import { usePlayerDataQuery } from './usePlayerData';
import { useTeamNeeds } from './useTeamNeeds';

interface ShadowRecommendationLoggingInput {
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
  const draftedPlayerIds = useDraftView((view) => view.draftedPlayerIds);
  const myRoster = useDraftView((view) => view.myRoster);
  const config = useDraftState((state) => state.config);
  const leagueSettingsFingerprint = useDraftState(
    (state) => state.leagueSettings.fingerprint
  );
  const currentPick = useDraftView((view) => view.currentPick);
  const isMyTurn = useDraftView((view) => view.isMyTurn);
  const attemptedEventIds = useRef(new Set<string>());
  const timingEvidence = useLeagueTimingEvidence(dataInfo.shadowLoggingEnabled && draftReady);
  const context = useMemo(() => ({
    currentPick,
    myPickPosition: config.myPickPosition,
    totalTeams: config.totalTeams,
    totalRounds: config.totalRounds,
    draftType: config.draftType,
  }), [config.myPickPosition, config.totalRounds, config.totalTeams, config.draftType, currentPick]);

  useEffect(() => {
    const attemptedIds = attemptedEventIds.current;
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
    if (attemptedIds.has(eventId)) return;
    attemptedIds.add(eventId);

    // Run the experiment after the core decision has committed. Shadow scoring
    // and network failures cannot hold up the recommendation under the clock.
    let started = false;
    const timeout = window.setTimeout(() => {
      started = true;
      try {
        const availableModel = applyLeagueSurvivalModel(
          shadowPlayers,
          timingEvidence.model,
          context
        ).filter((player) => !draftedPlayerIds.has(player.id));
        const playersById = new Map(
          shadowPlayers.map((player) => [player.id, player])
        );
        const rosterPlayers = POSITIONS.map(position => myRoster[position]).flatMap((ids) =>
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
        const shadowRecommendations = getRecommendations(
          availableModel,
          needs,
          5,
          {
            currentPick,
            totalPicks: config.totalTeams * config.totalRounds,
            totalTeams: config.totalTeams,
            isMyTurn,
            requirements: config.rosterRequirements,
            rosterPlayers,
            selectionsRemaining: Math.max(0, config.totalRounds - rosterPlayers.length),
            rosterCounts: {
              QB: myRoster.QB.length,
              RB: myRoster.RB.length,
              WR: myRoster.WR.length,
              TE: myRoster.TE.length,
              K: myRoster.K.length,
              DEF: myRoster.DEF.length,
            },
          },
          DRAFT_DISPLAY
        ).draftNow;

        if (shadowRecommendations.length === 0) {
          attemptedIds.delete(eventId);
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
          rosterPlayerIds: POSITIONS.map(position => myRoster[position]).flat(),
          positionNeeds: needs,
        });

        void postShadowRecommendation(endpoint, event).then((recorded) => {
          if (!recorded) attemptedIds.delete(eventId);
        });
      } catch {
        attemptedIds.delete(eventId);
      }
    }, 0);

    return () => {
      if (!started) {
        window.clearTimeout(timeout);
        attemptedIds.delete(eventId);
      }
    };
  }, [config.myPickPosition, config.rosterRequirements, config.totalRounds, config.totalTeams, context, coreBestPick, coreBestPlayer, corePolicy, coreRecommendations, currentPick, dataInfo.predictionGeneratedAt, dataInfo.predictionModelVersion, dataInfo.shadowLoggingEnabled, dataInfo.shadowLoggingEndpoint, dataInfo.shadowLoggingSeason, draftId, draftProvider, draftReady, draftedPlayerIds, isMyTurn, leagueSettingsFingerprint, myRoster, needs, shadowPlayers, timingEvidence.model]);
}
