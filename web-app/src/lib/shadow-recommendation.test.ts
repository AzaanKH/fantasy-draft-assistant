import { describe, expect, it, vi } from 'vitest';
import {
  isShadowRecommendationEvent,
  type PositionNeed,
  type Recommendation,
} from '@fantasy-draft/shared';
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

function buildEvent() {
  return buildShadowRecommendationEvent({
    season: 2026,
    draftId: 'primary-draft',
    draftProvider: 'sleeper',
    pickNumber: 27,
    observedAt: '2026-08-24T18:00:00.000Z',
    modelVersion: 'position-ridge-v4',
    predictionGeneratedAt: '2026-08-24T17:00:00.000Z',
    corePolicy: 'primary-league-policy',
    coreBestPick: BEST_PICK,
    coreBestPlayer: BEST_PLAYER,
    coreRecommendations: [BEST_PICK, BEST_PLAYER],
    shadowRecommendations: [SHADOW_PICK],
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
        freshness: 'ready',
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
    await expect(request).resolves.toBe(false);
    expect(event.coreDecision.bestPlayer.playerId).toBe('best-player');
  });
});
