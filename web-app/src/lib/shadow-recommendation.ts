import { http } from '@fantasy-draft/shared/http';
import { BROWSER_HTTP_POLICY } from '@/lib/http';
import type {
  PositionNeed,
  Recommendation,
  ShadowRecommendation,
  ShadowRecommendationEvent,
} from '@fantasy-draft/shared/draft';
import type {
  DraftProvider,
} from '@fantasy-draft/shared/sync';

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

interface BuildShadowRecommendationEventInput {
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
      shadowRecommendations[0] !== undefined &&
      input.coreBestPick.playerId !== shadowRecommendations[0].playerId,
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
  fetcher?: typeof fetch
): Promise<boolean> {
  try {
    await http.json(endpoint, value => {
      if (typeof value !== 'object' || value === null || !('eventId' in value) ||
        typeof value.eventId !== 'string' || !('recorded' in value) || typeof value.recorded !== 'boolean') {
        throw new Error('Invalid shadow recommendation receipt');
      }
      return { eventId: value.eventId, recorded: value.recorded };
    }, BROWSER_HTTP_POLICY, { fetch: fetcher, init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    } });
    return true;
  } catch {
    return false;
  }
}
