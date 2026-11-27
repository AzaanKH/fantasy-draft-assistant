import { decodeShadowRecommendationEvent, isShadowRecommendationEvent } from '@fantasy-draft/shared/catalog';
import { describe, expect, it, vi } from 'vitest';
import {
  type PositionNeed,
  type Recommendation,
} from '@fantasy-draft/shared/draft';
import {
  buildShadowRecommendationEvent,
  postShadowRecommendation,
} from './shadow-recommendation';

const BEST_PICK: Recommendation = {
  playerId: 'best-pick',
  playerName: 'Best Pick',
  position: 'RB',
  reason: 'Primary League policy',
  score: 12,
};

const BEST_PLAYER: Recommendation = {
  playerId: 'best-player',
  playerName: 'Best Player',
  position: 'WR',
  reason: 'Trusted ECR Anchor #1',
  score: -1,
};

const SHADOW_PICK: Recommendation = {
  playerId: 'shadow-pick',
  playerName: 'Shadow Pick',
  position: 'TE',
  reason: 'Experimental model',
  score: 18,
};

const NEEDS: readonly PositionNeed[] = [{
  position: 'RB',
  priority: 'critical',
  startersFilled: 0,
  startersNeeded: 2,
  flexSlotsFilled: 0,
  flexSlotsNeeded: 2,
  isFlexEligible: true,
  scarcityScore: 8,
}];

const DEPENDENCIES = {
  rankingsRefreshedAt: '2026-08-24T16:00:00.000Z',
  identitiesGeneratedAt: '2026-08-24T16:00:00.000Z',
  teamEnvironmentGeneratedAt: null,
};

function buildEvent(
  shadowRecommendations: readonly Recommendation[] = [SHADOW_PICK],
  predictionFreshness: 'ready' | 'older-than-dependency' | 'stale' = 'ready'
) {
  return buildShadowRecommendationEvent({
    season: 2026,
    draftId: 'primary-draft',
    draftProvider: 'sleeper',
    pickNumber: 27,
    observedAt: '2026-08-24T18:00:00.000Z',
    modelVersion: 'position-ridge-v4',
    predictionGeneratedAt: '2026-08-24T17:00:00.000Z',
    predictionTargetSeason: 2026,
    predictionFreshness,
    predictionDependencies: DEPENDENCIES,
    corePolicy: 'primary-league-policy',
    coreBestPick: BEST_PICK,
    coreBestPlayer: BEST_PLAYER,
    coreRecommendations: [BEST_PICK, BEST_PLAYER],
    shadowRecommendations,
    leagueSettingsFingerprint: 'primary-league-fingerprint',
    totalTeams: 10,
    totalRounds: 14,
    myPickPosition: 7,
    draftedPlayerIds: ['drafted-b', 'drafted-a'],
    rosterPlayerIds: ['roster-b', 'roster-a'],
    positionNeeds: NEEDS,
  });
}

describe('Shadow Recommendation telemetry', () => {
  it('records the experiment only as shadow output beside the actual core decision', () => {
    const event = buildEvent();

    expect(isShadowRecommendationEvent(event)).toBe(true);
    expect(event).toMatchObject({
      eventId: '2026:sleeper:primary-draft:27',
      experiment: {
        sourceLabel: 'Experimental prediction artifact',
        modelVersion: 'position-ridge-v4',
        generatedAt: '2026-08-24T17:00:00.000Z',
        targetSeason: 2026,
        freshness: 'ready',
        dependencies: DEPENDENCIES,
      },
      coreDecision: {
        ecrAnchor: 'FantasyPros ECR',
        policy: 'primary-league-policy',
        bestPick: { playerId: 'best-pick' },
        bestPlayer: { playerId: 'best-player' },
      },
      shadowRecommendations: [{ playerId: 'shadow-pick' }],
      disagreement: true,
      context: {
        draftProvider: 'sleeper',
        leagueSettingsFingerprint: 'primary-league-fingerprint',
        draftedPlayerIds: ['drafted-a', 'drafted-b'],
        rosterPlayerIds: ['roster-a', 'roster-b'],
        positionNeeds: [{ position: 'RB', priority: 'critical' }],
      },
    });
  });

  it('records degraded prediction freshness and still reads rows written before it existed', () => {
    const event = buildEvent([SHADOW_PICK], 'older-than-dependency');
    expect(isShadowRecommendationEvent(event)).toBe(true);
    expect(event.experiment).toMatchObject({ freshness: 'older-than-dependency', dependencies: DEPENDENCIES });

    const { dependencies: _dependencies, ...legacyExperiment } = buildEvent().experiment;
    const legacy = { ...buildEvent(), experiment: legacyExperiment };
    expect(decodeShadowRecommendationEvent(legacy).experiment.freshness).toBe('ready');
    expect(isShadowRecommendationEvent({ ...legacy, experiment: { ...legacyExperiment, freshness: 'missing' } })).toBe(false);
  });

  it('does not report disagreement without a shadow candidate or when the picks match', () => {
    expect(buildEvent([]).disagreement).toBe(false);
    expect(buildEvent([BEST_PICK]).disagreement).toBe(false);
  });

  it('contains logging failures and leaves the core decision usable', async () => {
    const event = buildEvent();
    const failingFetch = vi.fn<typeof fetch>().mockRejectedValue(
      new Error('shadow sink unavailable')
    );
    const request = postShadowRecommendation(
      '/api/shadow-recommendations',
      event,
      failingFetch
    );

    expect(event.coreDecision.bestPick.playerId).toBe('best-pick');
    await expect(request).resolves.toBe('retryable');
    expect(event.coreDecision.bestPlayer.playerId).toBe('best-player');
  });

  it('accepts the decoded receipt through an injected fetch', async () => {
    const event = buildEvent();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ eventId: event.eventId, recorded: true }));
    await expect(postShadowRecommendation('/api/shadow-recommendations', event, fetcher)).resolves.toBe('recorded');
    expect(fetcher).toHaveBeenCalledWith('/api/shadow-recommendations', expect.objectContaining({
      method: 'POST', body: JSON.stringify(event),
    }));
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('contains malformed receipts and HTTP failures', async () => {
    const cases: [Response, string][] = [
      [Response.json({ recorded: 'yes' }), 'retryable'],
      [new Response(null, { status: 503 }), 'retryable'],
      [new Response(null, { status: 429 }), 'retryable'],
      [new Response(null, { status: 422 }), 'rejected'],
      [new Response(null, { status: 400 }), 'rejected'],
    ];
    for (const [response, outcome] of cases) {
      await expect(postShadowRecommendation('/api/shadow-recommendations', buildEvent(),
        vi.fn(async () => response))).resolves.toBe(outcome);
    }
  });
});
