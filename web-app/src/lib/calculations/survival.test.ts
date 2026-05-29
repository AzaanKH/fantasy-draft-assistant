import { describe, expect, it } from 'vitest';
import type { Player } from '@fantasy-draft/shared';
import {
  estimateLeagueSurvivalProbability,
  getNextUserPick,
  type LeagueSurvivalModel,
} from './survival';

function createPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Player One',
    position: 'QB',
    team: 'BAL',
    byeWeek: 7,
    ecrRank: 38,
    sleeperAdp: 40,
    valueScore: 2,
    marketRank: 40,
    marketAdp: 40,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 7,
    projectedPoints: 250,
    valueOverReplacement: 20,
    tier: 1,
    tierDropoffScore: 0.8,
    nextPickSurvivalProbability: 0.5,
    ceilingScore: 9,
    floorScore: 7,
    upsideScore: 8,
    uncertaintyScore: 4,
    injuryRiskScore: 1,
    predictionSource: 'model',
    newsStatus: 'healthy',
    stackPartnerTeam: 'BAL',
    highlightLevel: 'neutral',
    ...overrides,
  };
}

const model: LeagueSurvivalModel = {
  generatedAt: '2026-05-29T00:00:00.000Z',
  modelVersion: 'test',
  leagueName: 'Test League',
  seasons: [2022, 2023, 2024, 2025],
  sampleSize: 500,
  positions: {
    QB: {
      position: 'QB',
      leagueMedianPick: 47,
      sleeperMedianPick: 62,
      pickPremium: -15,
      top50RateDelta: 0.2,
      top100RateDelta: 0.1,
      sampleSize: 48,
    },
    RB: {
      position: 'RB',
      leagueMedianPick: 55,
      sleeperMedianPick: 50,
      pickPremium: 5,
      top50RateDelta: -0.05,
      top100RateDelta: -0.02,
      sampleSize: 120,
    },
    WR: {
      position: 'WR',
      leagueMedianPick: 60,
      sleeperMedianPick: 60,
      pickPremium: 0,
      top50RateDelta: 0,
      top100RateDelta: 0,
      sampleSize: 130,
    },
    TE: {
      position: 'TE',
      leagueMedianPick: 76,
      sleeperMedianPick: 90,
      pickPremium: -14,
      top50RateDelta: 0.15,
      top100RateDelta: 0.08,
      sampleSize: 45,
    },
    K: {
      position: 'K',
      leagueMedianPick: 130,
      sleeperMedianPick: 145,
      pickPremium: -15,
      top50RateDelta: 0,
      top100RateDelta: 0,
      sampleSize: 20,
    },
    DEF: {
      position: 'DEF',
      leagueMedianPick: 120,
      sleeperMedianPick: 135,
      pickPremium: -15,
      top50RateDelta: 0,
      top100RateDelta: 0,
      sampleSize: 20,
    },
  },
};

describe('getNextUserPick', () => {
  it('finds the next pick in a snake draft', () => {
    expect(getNextUserPick({
      currentPick: 8,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    })).toBe(13);
  });

  it('returns null after the final user pick', () => {
    expect(getNextUserPick({
      currentPick: 138,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    })).toBeNull();
  });
});

describe('estimateLeagueSurvivalProbability', () => {
  it('lowers survival when the league takes the player position early', () => {
    const player = createPlayer({ position: 'QB', sleeperAdp: 40 });

    const result = estimateLeagueSurvivalProbability(player, model, {
      currentPick: 18,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    });

    expect(result.survivalModelSource).toBe('league-history');
    expect(result.leagueAdjustedMarketRank).toBeLessThan(player.sleeperAdp);
    expect(result.nextPickSurvivalProbability).toBeLessThan(0.5);
    expect(result.leaguePositionTendency).toContain('QBs go');
  });

  it('falls back cleanly when no model is available', () => {
    const player = createPlayer({
      leagueAdjustedMarketRank: 30,
      leagueMarketDelta: -10,
      leaguePositionTendency: 'QBs go early here',
      survivalModelSource: 'league-history',
    });

    const result = estimateLeagueSurvivalProbability(player, null, {
      currentPick: 28,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    });

    expect(result.nextPickSurvivalProbability).toBe(player.nextPickSurvivalProbability);
    expect(result.survivalModelSource).toBe('heuristic');
    expect(result.leagueAdjustedMarketRank).toBeUndefined();
    expect(result.leagueMarketDelta).toBeUndefined();
    expect(result.leaguePositionTendency).toBeUndefined();
  });
});
