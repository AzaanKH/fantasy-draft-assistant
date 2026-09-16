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
    positionalRank: 6,
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

const historicalPickNumbers: NonNullable<
  LeagueSurvivalModel['historicalPickNumbers']
> = {
  QB: [5, 8, 12, 16, 20, 24, 28, 34, 40, 48, 58, 70],
  RB: [1, 3, 6, 9, 14, 20, 27, 35, 44, 55, 68, 82, 101, 122],
  WR: [2, 4, 7, 11, 16, 22, 29, 37, 46, 57, 70, 86, 104, 126],
  TE: [10, 19, 28, 42, 56, 73, 91, 110, 130],
  K: [105, 112, 118, 123, 128, 132, 136, 140],
  DEF: [102, 110, 117, 124, 129, 133, 137, 140],
};

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
  historicalPickNumbers,
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
    const laterRoomResult = estimateLeagueSurvivalProbability(player, {
      ...model,
      historicalPickNumbers: {
        ...historicalPickNumbers,
        QB: historicalPickNumbers.QB.map((pick) => pick + 30),
      },
    }, {
      currentPick: 18,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    });

    expect(result.survivalModelSource).toBe('league-history');
    expect(result.leagueAdjustedMarketRank).toBeLessThan(player.sleeperAdp);
    expect(result.nextPickSurvivalProbability)
      .toBeLessThan(laterRoomResult.nextPickSurvivalProbability);
    expect(result.nextPickNumber).toBe(28);
    expect(result.nextPickLabel).toBe('3.08');
    expect(result.leaguePositionTendency).toContain('QBs go');
  });

  it('keeps Primary League history dominant over current consensus and Sleeper timing', () => {
    const context = {
      currentPick: 18,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    };
    const basePlayer = createPlayer({
      marketAdp: 40,
      marketRank: 40,
      consensusAdp: 40,
      sleeperAdp: 40,
      sleeperSearchRank: 40,
    });
    const earlyHistory = {
      ...model,
      historicalPickNumbers: {
        ...historicalPickNumbers,
        QB: [10, 12, 14, 16, 18, 20, 22, 24],
      },
    };
    const lateHistory = {
      ...model,
      historicalPickNumbers: {
        ...historicalPickNumbers,
        QB: [40, 42, 44, 46, 48, 50, 52, 54],
      },
    };
    const early = estimateLeagueSurvivalProbability(basePlayer, earlyHistory, context);
    const late = estimateLeagueSurvivalProbability(basePlayer, lateHistory, context);
    const consensusMove = estimateLeagueSurvivalProbability({
      ...basePlayer,
      consensusAdp: 60,
      marketAdp: 60,
      marketRank: 60,
    }, earlyHistory, context);
    const sleeperMove = estimateLeagueSurvivalProbability({
      ...basePlayer,
      sleeperAdp: 80,
      sleeperSearchRank: 80,
    }, earlyHistory, context);

    const historyEffect = (late.leagueAdjustedMarketRank ?? 0) -
      (early.leagueAdjustedMarketRank ?? 0);
    const consensusEffect = (consensusMove.leagueAdjustedMarketRank ?? 0) -
      (early.leagueAdjustedMarketRank ?? 0);
    const sleeperEffect = (sleeperMove.leagueAdjustedMarketRank ?? 0) -
      (early.leagueAdjustedMarketRank ?? 0);

    expect(historyEffect).toBeGreaterThan(consensusEffect);
    expect(consensusEffect).toBeGreaterThan(sleeperEffect);
    expect(early.historicalExpectedPick).toBe(17);
    expect(early.consensusMarketPick).toBe(40);
    expect(early.sleeperTimingPick).toBe(40);
    expect(early.survivalModelSampleSize).toBe(8);
  });

  it('uses current consensus market cost to calibrate the historical estimate', () => {
    const context = {
      currentPick: 18,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    };
    const currentPlayer = createPlayer({
      consensusAdp: 30,
      marketAdp: 30,
      marketRank: 30,
      sleeperAdp: 40,
      sleeperSearchRank: 40,
    });
    const laterMarketPlayer = {
      ...currentPlayer,
      consensusAdp: 50,
      marketAdp: 50,
      marketRank: 50,
    };
    const current = estimateLeagueSurvivalProbability(currentPlayer, model, context);
    const laterMarket = estimateLeagueSurvivalProbability(
      laterMarketPlayer,
      model,
      context
    );

    expect(laterMarket.historicalExpectedPick).toBe(current.historicalExpectedPick);
    expect((laterMarket.leagueAdjustedMarketRank ?? 0) -
      (current.leagueAdjustedMarketRank ?? 0)).toBeCloseTo(5);
    expect(laterMarket.nextPickSurvivalProbability)
      .toBeGreaterThan(current.nextPickSurvivalProbability);
  });

  it('keeps Sleeper search rank as a smaller timing-only calibration', () => {
    const context = {
      currentPick: 18,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    };
    const earlySleeper = createPlayer({
      consensusAdp: 40,
      marketAdp: 40,
      marketRank: 40,
      sleeperAdp: 20,
      sleeperSearchRank: 20,
    });
    const lateSleeper = {
      ...earlySleeper,
      sleeperAdp: 80,
      sleeperSearchRank: 80,
    };
    const early = estimateLeagueSurvivalProbability(earlySleeper, model, context);
    const late = estimateLeagueSurvivalProbability(lateSleeper, model, context);

    expect(late.historicalExpectedPick).toBe(early.historicalExpectedPick);
    expect(late.consensusMarketPick).toBe(early.consensusMarketPick);
    expect((late.leagueAdjustedMarketRank ?? 0) -
      (early.leagueAdjustedMarketRank ?? 0)).toBeCloseTo(3);
    expect(late.ecrRank).toBe(early.ecrRank);
    expect(late.projectedPoints).toBe(early.projectedPoints);
  });

  it('reconditions the same next-pick horizon after each live pick', () => {
    const player = createPlayer();
    const atPick18 = estimateLeagueSurvivalProbability(player, model, {
      currentPick: 18,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    });
    const atPick19 = estimateLeagueSurvivalProbability(player, model, {
      currentPick: 19,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    });

    expect(atPick18.nextPickNumber).toBe(28);
    expect(atPick19.nextPickNumber).toBe(28);
    expect(atPick19.picksUntilNextPick).toBe(9);
    expect(atPick19.nextPickSurvivalProbability)
      .toBeGreaterThan(atPick18.nextPickSurvivalProbability);
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

  it('stops at the manager\'s final selection instead of extending the horizon', () => {
    const player = createPlayer();
    const result = estimateLeagueSurvivalProbability(player, model, {
      currentPick: 138,
      myPickPosition: 8,
      totalTeams: 10,
      totalRounds: 14,
    });

    expect(result.nextPickNumber).toBeUndefined();
    expect(result.nextPickLabel).toBeUndefined();
    expect(result.picksUntilNextPick).toBeUndefined();
    expect(result.survivalModelSource).toBe('heuristic');
  });
});
