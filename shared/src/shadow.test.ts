import { describe, expect, it } from 'vitest';
import { decodeShadowRecommendationEvent } from './catalog/shadow-decoders.js';
import { isShadowEventSeasonEligible, shadowSeasonEligibility } from './shadow.js';

describe('shadowSeasonEligibility', () => {
  it('accepts only when the workspace, artifact, and policy seasons agree', () => {
    expect(shadowSeasonEligibility({ workspace: 2026, artifact: 2026, policy: 2026 })).toEqual({ eligible: true, season: 2026 });
    expect(shadowSeasonEligibility({ workspace: 2026, artifact: 2025, policy: 2026 }).eligible).toBe(false);
    expect(shadowSeasonEligibility({ workspace: 2026, artifact: 2026, policy: 2025 }).eligible).toBe(false);
    expect(shadowSeasonEligibility({ workspace: 2027, artifact: 2026, policy: 2026 }).eligible).toBe(false);
  });

  it('fails closed for an artifact without a recorded target season', () => {
    expect(shadowSeasonEligibility({ workspace: 2026, artifact: undefined, policy: 2026 })).toMatchObject({
      eligible: false, reason: expect.stringMatching(/does not record its target season/) as unknown,
    });
  });
});

describe('isShadowEventSeasonEligible', () => {
  const recommendation = { playerId: 'p', playerName: 'P', position: 'WR', score: 1 };
  const legacyRow = {
    eventId: '2026:sleeper:d:1', season: 2026, draftId: 'd', pickNumber: 1, observedAt: '2026-09-05T16:30:00.000Z',
    experiment: { sourceLabel: 'Experimental prediction artifact', modelVersion: 'm', generatedAt: '2026-09-05T15:00:00.000Z', freshness: 'ready' },
    coreDecision: { ecrAnchor: 'FantasyPros ECR', policy: 'p', bestPick: recommendation, bestPlayer: recommendation, recommendations: [recommendation] },
    shadowRecommendations: [recommendation], disagreement: false,
    context: { draftProvider: 'sleeper', leagueSettingsFingerprint: 'f', totalTeams: 10, totalRounds: 15, myPickPosition: 1,
      draftedPlayerIds: [], rosterPlayerIds: [], positionNeeds: [] },
  };

  it('still decodes rows logged before the target season was recorded, but does not accept new ones without it', () => {
    const legacy = decodeShadowRecommendationEvent(legacyRow);
    expect(isShadowEventSeasonEligible(legacy, 2026)).toBe(false);
    const current = decodeShadowRecommendationEvent({ ...legacyRow, experiment: { ...legacyRow.experiment, targetSeason: 2026 } });
    expect(isShadowEventSeasonEligible(current, 2026)).toBe(true);
    expect(isShadowEventSeasonEligible(current, 2027)).toBe(false);
  });
});
