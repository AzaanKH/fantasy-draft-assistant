import { describe, expect, it, vi } from 'vitest';
import type {
  ECRPlayer,
  FantasyProsProjection,
  NFLTeam,
  Player,
  TeamEnvironment,
} from '@fantasy-draft/shared';
import {
  filterDrafted,
  mergePlayerData,
  type SleeperADPPlayer,
} from './player-value';

const teamEnvironment = {
  DET: {
    team: 'DET',
    name: 'Detroit Lions',
    offenseScore: 8,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 2,
    passAttemptsRank: 10,
    rushAttemptsRank: 12,
    coachingStability: true,
  },
  SEA: {
    team: 'SEA',
    name: 'Seattle Seahawks',
    offenseScore: 6,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 16,
    passAttemptsRank: 15,
    rushAttemptsRank: 15,
    coachingStability: true,
  },
} as unknown as Record<NFLTeam, TeamEnvironment>;

function createEcrPlayer(overrides: Partial<ECRPlayer> = {}): ECRPlayer {
  return {
    rank: 1,
    name: 'Test Player',
    position: 'WR',
    team: 'DET',
    byeWeek: 5,
    positionalRank: 1,
    bestRank: 1,
    worstRank: 3,
    avgRank: 2,
    ...overrides,
  };
}

function createSleeperPlayer(overrides: Partial<SleeperADPPlayer> = {}): SleeperADPPlayer {
  return {
    playerId: '123',
    name: 'Test Player',
    position: 'WR',
    team: 'DET',
    sleeperAdp: 10,
    age: 25,
    yearsExp: 4,
    status: 'Active',
    ...overrides,
  };
}

describe('mergePlayerData', () => {
  it('carries the Primary League scoring delta into the live player record', () => {
    const projection: FantasyProsProjection = {
      name: 'Test Player',
      position: 'TE',
      team: 'DET',
      projectedPoints: 200,
      baseProjectedPoints: 200,
      projectedRushAttempts: 10,
      projectedReceptions: 80,
    };
    const players = mergePlayerData(
      [createEcrPlayer({ position: 'TE' })],
      [projection],
      [],
      [createSleeperPlayer({ position: 'TE' })],
      teamEnvironment
    );

    expect(players[0]?.projectedPoints).toBe(242);
    expect(players[0]?.leagueScoringAdjustment).toBe(42);
  });

  it('treats inactive sleeper statuses as out instead of healthy', () => {
    const players = mergePlayerData(
      [createEcrPlayer()],
      [],
      [],
      [createSleeperPlayer({ status: 'Inactive' })],
      teamEnvironment
    );

    expect(players[0]?.newsStatus).toBe('out');
  });

  it('lets explicit out news override active sleeper status for injury risk', () => {
    const players = mergePlayerData(
      [createEcrPlayer()],
      [],
      [{
        name: 'Test Player',
        position: 'WR',
        team: 'DET',
        status: 'out',
        headline: 'Ruled out',
        updatedAt: '2026-05-29T00:00:00.000Z',
      }],
      [createSleeperPlayer({ status: 'Active' })],
      teamEnvironment
    );

    expect(players[0]?.newsStatus).toBe('out');
    expect(players[0]?.injuryRiskScore).toBe(9);
  });

  it('keeps the published FantasyPros tier separate from the local tier source', () => {
    const players = mergePlayerData(
      [createEcrPlayer({ fantasyProsTier: 3 })],
      [],
      [],
      [createSleeperPlayer()],
      teamEnvironment
    );

    expect(players[0]?.fantasyProsTier).toBe(3);
    expect(players[0]?.tierSource).toBe('ecr-fallback');
    expect(players[0]?.tier).toBe(1);
  });

  it('falls back to name-plus-position matching when offseason team data drifts', () => {
    const players = mergePlayerData(
      [createEcrPlayer({ name: 'Kenneth Walker III', position: 'RB', team: 'KC' })],
      [],
      [],
      [createSleeperPlayer({
        name: 'Kenneth Walker',
        position: 'RB',
        team: 'SEA',
        playerId: '8151',
        sleeperAdp: 42,
      })],
      teamEnvironment
    );

    expect(players[0]?.id).toBe('8151');
    expect(players[0]?.team).toBe('SEA');
    expect(players[0]?.sleeperAdp).toBe(42);
  });

  it('uses the Sleeper-resolved team for enrichment lookups', () => {
    const players = mergePlayerData(
      [createEcrPlayer({ name: 'Kenneth Walker III', position: 'RB', team: 'KC' })],
      [],
      [{
        name: 'Kenneth Walker',
        position: 'RB',
        team: 'SEA',
        status: 'out',
        headline: 'Ruled out',
        updatedAt: '2026-05-29T00:00:00.000Z',
      }],
      [createSleeperPlayer({
        name: 'Kenneth Walker',
        position: 'RB',
        team: 'SEA',
        playerId: '8151',
        sleeperAdp: 42,
        status: 'Active',
      })],
      teamEnvironment,
      [{
        name: 'Kenneth Walker',
        position: 'RB',
        team: 'SEA',
        contractEndYear: 2026,
        isContractYear: true,
      }],
      [{
        name: 'Kenneth Walker',
        position: 'RB',
        team: 'SEA',
        projectedPoints: 180,
        source: 'model',
      }]
    );

    expect(players[0]?.team).toBe('SEA');
    expect(players[0]?.isContractYear).toBe(true);
    expect(players[0]?.newsStatus).toBe('out');
    expect(players[0]?.projectedPoints).toBe(180);
    expect(players[0]?.predictionSource).toBe('model');
  });

  it('uses model prediction overrides before heuristic projections', () => {
    const players = mergePlayerData(
      [createEcrPlayer()],
      [],
      [],
      [createSleeperPlayer({ playerId: '123' })],
      teamEnvironment,
      [],
      [{
        playerId: '123',
        name: 'Test Player',
        position: 'WR',
        team: 'DET',
        projectedPoints: 241.5,
        valueOverReplacement: 44.2,
        ceilingScore: 9.1,
        floorScore: 6.4,
        uncertaintyScore: 4.8,
        injuryRiskScore: 2.5,
        source: 'model',
        modelVersion: 'test',
      }]
    );

    expect(players[0]?.projectedPoints).toBe(241.5);
    expect(players[0]?.valueOverReplacement).toBe(44.2);
    expect(players[0]?.ceilingScore).toBe(9.1);
    expect(players[0]?.floorScore).toBe(6.4);
    expect(players[0]?.uncertaintyScore).toBe(4.8);
    expect(players[0]?.injuryRiskScore).toBe(2.5);
    expect(players[0]?.predictionSource).toBe('model');
  });

  it('uses model risk as information without enabling model point projections', () => {
    const players = mergePlayerData(
      [createEcrPlayer()],
      [],
      [],
      [createSleeperPlayer({ playerId: '123', status: 'Active' })],
      teamEnvironment,
      [],
      [],
      [],
      [],
      undefined,
      [{
        playerId: '123',
        name: 'Test Player',
        position: 'WR',
        team: 'DET',
        projectedPoints: 999,
        uncertaintyScore: 6,
        injuryRiskScore: 7,
        source: 'model',
      }]
    );

    expect(players[0]?.projectedPoints).not.toBe(999);
    expect(players[0]?.predictionSource).toBe('heuristic');
    expect(players[0]?.uncertaintyScore).toBe(6);
    expect(players[0]?.injuryRiskScore).toBe(7);
  });

  it('raises uncertainty for rookies without treating them as injured', () => {
    const veteran = mergePlayerData(
      [createEcrPlayer()],
      [],
      [],
      [createSleeperPlayer({ yearsExp: 4, status: 'Active' })],
      teamEnvironment
    )[0];

    const rookie = mergePlayerData(
      [createEcrPlayer()],
      [],
      [],
      [createSleeperPlayer({ yearsExp: 0, status: 'Active' })],
      teamEnvironment
    )[0];

    expect(rookie?.uncertaintyScore).toBeGreaterThan(veteran?.uncertaintyScore ?? 0);
    expect(rookie?.injuryRiskScore).toBe(2);
  });

  it('keeps missing Sleeper status at neutral availability risk', () => {
    const players = mergePlayerData(
      [createEcrPlayer()],
      [],
      [],
      [],
      teamEnvironment
    );

    expect(players[0]?.injuryRiskScore).toBe(2);
  });

  it('reports each unmatched ECR player cohort once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unmatchedPlayer = createEcrPlayer({ name: 'Unmatched Player' });

    try {
      mergePlayerData([unmatchedPlayer], [], [], [], teamEnvironment);
      mergePlayerData([unmatchedPlayer], [], [], [], teamEnvironment);
      mergePlayerData(
        [createEcrPlayer({ name: 'Unmatched Player', team: 'SEA' })],
        [],
        [],
        [],
        teamEnvironment
      );

      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('treats the Sleeper unranked sentinel as neutral market data', () => {
    const players = mergePlayerData(
      [createEcrPlayer({ rank: 318, name: 'Greg Dulcich', position: 'TE' })],
      [],
      [],
      [createSleeperPlayer({
        name: 'Greg Dulcich',
        position: 'TE',
        sleeperAdp: 9_999_999,
      })],
      teamEnvironment
    );

    expect(players[0]?.sleeperAdp).toBe(318);
    expect(players[0]?.marketRank).toBe(318);
    expect(players[0]?.valueScore).toBe(0);
  });

  it('treats Sleeper placeholder rank 999 as neutral market data', () => {
    const players = mergePlayerData(
      [createEcrPlayer({ rank: 186, name: 'Brandon Aubrey', position: 'K' })],
      [],
      [],
      [createSleeperPlayer({
        name: 'Brandon Aubrey',
        position: 'K',
        sleeperAdp: 999,
      })],
      teamEnvironment
    );

    expect(players[0]?.sleeperAdp).toBe(186);
    expect(players[0]?.marketRank).toBe(186);
    expect(players[0]?.valueScore).toBe(0);
  });

  it('uses Fantasy Football Calculator ADP ahead of static ADP fallbacks', () => {
    const players = mergePlayerData(
      [createEcrPlayer({ rank: 20 })],
      [],
      [],
      [createSleeperPlayer({ sleeperAdp: 30 })],
      teamEnvironment,
      [],
      [],
      [{
        rank: 25,
        name: 'Test Player',
        position: 'WR',
        team: 'DET',
        positionalRank: 10,
        bestRank: 20,
        worstRank: 30,
        averageRank: 25,
      }],
      [],
      undefined,
      [],
      {
        marketAdp: [{
          externalId: 'ffc-1',
          name: 'Test Player',
          position: 'WR',
          team: 'DET',
          adp: 42.5,
        }],
      }
    );

    expect(players[0]?.marketAdp).toBe(42.5);
    expect(players[0]?.marketRank).toBe(42.5);
    expect(players[0]?.valueScore).toBe(22.5);
  });
});

describe('filterDrafted', () => {
  it('excludes a drafted player by name and position when provider IDs differ', () => {
    const matthewStafford = {
      id: '421',
      name: 'Matthew Stafford',
      position: 'QB',
    } as Player;

    expect(filterDrafted(
      [matthewStafford],
      new Set(['12483']),
      [{ playerName: 'Matthew Stafford', position: 'QB' }]
    )).toEqual([]);
  });

  it('uses the NFL team to distinguish same-name players at one position', () => {
    const detroitPlayer = {
      id: 'detroit-id',
      name: 'Same Name',
      position: 'WR',
      team: 'DET',
    } as Player;
    const ramsPlayer = {
      id: 'rams-id',
      name: 'Same Name',
      position: 'WR',
      team: 'LAR',
    } as Player;

    expect(filterDrafted(
      [detroitPlayer, ramsPlayer],
      new Set(['old-detroit-id']),
      [{ playerName: 'Same Name', position: 'WR', nflTeam: 'DET' }]
    )).toEqual([ramsPlayer]);
  });
});
