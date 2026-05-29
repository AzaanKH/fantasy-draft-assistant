import { describe, expect, it } from 'vitest';
import type { ECRPlayer, NFLTeam, TeamEnvironment } from '@fantasy-draft/shared';
import { mergePlayerData, type SleeperADPPlayer } from './player-value';

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

  it('clamps tier dropoff scores for players beyond the last threshold', () => {
    const players = mergePlayerData(
      [createEcrPlayer({ positionalRank: 60 })],
      [],
      [],
      [createSleeperPlayer()],
      teamEnvironment
    );

    expect(players[0]?.tierDropoffScore).toBeGreaterThanOrEqual(0);
    expect(players[0]?.tierDropoffScore).toBeLessThanOrEqual(1);
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
    expect(players[0]?.projectedPoints).toBe(99);
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
});
