import type {
  DraftProvider,
  PositionNeed,
  Recommendation,
  ShadowRecommendation,
  ShadowRecommendationEvent,
} from '@fantasy-draft/shared';

function compactRecommendation(
  recommendation: Recommendation
): ShadowRecommendation {
  return {
    playerId: recommendation.playerId,
    playerName: recommendation.playerName,
    position: recommendation.position,
    score: recommendation.score,
  };
}

export interface BuildShadowRecommendationEventInput {
  readonly season: number;
  readonly draftId: string;
  readonly draftProvider: DraftProvider;
  readonly pickNumber: number;
  readonly observedAt: string;
  readonly modelVersion: string;
  readonly predictionGeneratedAt: string;
  readonly corePolicy: string;
  readonly coreBestPick: Recommendation;
  readonly coreBestPlayer: Recommendation;
  readonly coreRecommendations: readonly Recommendation[];
  readonly shadowRecommendations: readonly Recommendation[];
  readonly leagueSettingsFingerprint: string;
  readonly totalTeams: number;
  readonly totalRounds: number;
  readonly myPickPosition: number;
  readonly draftedPlayerIds: readonly string[];
  readonly rosterPlayerIds: readonly string[];
  readonly positionNeeds: readonly PositionNeed[];
}

export function buildShadowRecommendationEvent(
  input: BuildShadowRecommendationEventInput
): ShadowRecommendationEvent {
  const coreRecommendations = input.coreRecommendations.slice(0, 5);
  const shadowRecommendations = input.shadowRecommendations.slice(0, 5);

  return {
    eventId: `${String(input.season)}:${input.draftProvider}:${input.draftId}:${String(input.pickNumber)}`,
    season: input.season,
    draftId: input.draftId,
    pickNumber: input.pickNumber,
    observedAt: input.observedAt,
    experiment: {
      sourceLabel: 'Experimental prediction artifact',
      modelVersion: input.modelVersion,
      generatedAt: input.predictionGeneratedAt,
      freshness: 'ready',
    },
    coreDecision: {
      ecrAnchor: 'FantasyPros ECR',
      policy: input.corePolicy,
      bestPick: compactRecommendation(input.coreBestPick),
      bestPlayer: compactRecommendation(input.coreBestPlayer),
      recommendations: coreRecommendations.map(compactRecommendation),
    },
    shadowRecommendations: shadowRecommendations.map(compactRecommendation),
    disagreement:
      shadowRecommendations.length > 0 &&
      input.coreBestPick.playerId !== shadowRecommendations[0]?.playerId,
    context: {
      draftProvider: input.draftProvider,
      leagueSettingsFingerprint: input.leagueSettingsFingerprint,
      totalTeams: input.totalTeams,
      totalRounds: input.totalRounds,
      myPickPosition: input.myPickPosition,
      draftedPlayerIds: [...input.draftedPlayerIds].sort(),
      rosterPlayerIds: [...input.rosterPlayerIds].sort(),
      positionNeeds: input.positionNeeds.map((need) => ({
        position: need.position,
        priority: need.priority,
      })),
    },
  };
}

/** Shadow telemetry is best effort and must never reject into the live UI. */
export async function postShadowRecommendation(
  endpoint: string,
  event: ShadowRecommendationEvent,
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    return response.ok;
  } catch {
    return false;
  }
}
