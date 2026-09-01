import { describe, expect, it } from 'vitest';
import { runPrimaryLeagueRehearsal } from './primary-league-rehearsal';

describe('Primary League release rehearsal', () => {
  it('completes the provider-confirmed draft through outage and reconciliation', () => {
    const result = runPrimaryLeagueRehearsal(
      Date.parse('2026-08-25T15:57:03.000Z')
    );

    expect(result.status).toBe('passed');
    expect(result.configuration).toMatchObject({
      totalTeams: 10,
      totalRounds: 14,
      totalPicks: 140,
      keeperCount: 10,
      scoring: {
        reception: 1,
        tightEndPremium: 0.5,
        rushAttemptBonus: 0.2,
      },
    });
    expect(result.transitions.recommendationChecks).toBeGreaterThan(100);
    expect(result.transitions.waitingRecommendationChecks).toBeGreaterThan(80);
    expect(result.transitions.noDecisionChecks).toBeGreaterThan(0);
    expect(result.transitions.synchronizationStates).toEqual([
      'confirmed',
      'delayed',
      'manual-continuity',
      'reconciling',
      'confirmed',
      'complete',
    ]);
    expect(result.reconciliation).toEqual({
      confirmations: 1,
      corrections: 1,
      removals: 1,
      visibleOutcomes: ['Confirmed', 'Corrected', 'Removed'],
    });
    expect(result.completion).toMatchObject({
      canonicalPicks: 140,
      providerPicks: 130,
      keeperPicks: 10,
      missedPickNumbers: [],
      duplicatePickNumbers: [],
      duplicatePlayerIds: [],
      rosterMismatches: [],
      remainingAvailablePlayerIds: [
        'provisional-conflict',
        'provisional-extra',
      ],
      currentPick: 141,
    });
    expect(result.failures).toEqual([]);
  });
});
