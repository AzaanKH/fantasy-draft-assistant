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
});
