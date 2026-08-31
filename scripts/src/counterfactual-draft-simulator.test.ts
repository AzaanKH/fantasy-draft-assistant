import { describe, expect, it } from 'vitest';
import {
  estimateMetric,
  runCounterfactualDraft,
  simulateCounterfactualSeason,
  type CounterfactualPlayer,
  type CounterfactualSeason,
  type SimulatedPosition,
} from './counterfactual-draft-simulator.js';

function player(
  id: string,
  position: SimulatedPosition,
  marketRank: number,
  modelValue: number = 100
): CounterfactualPlayer {
  return {
    id,
    name: id,
    position,
    marketRank,
    modelValue,
    actualPoints: 200 - marketRank,
    actualVor: 100 - marketRank,
  };
}

const season: CounterfactualSeason = {
  season: 2025,
  rosterPositions: ['QB', 'RB'],
  rosterIdToOwner: { '1': 'user', '2': 'opponent' },
  picks: [
    {
      pickNo: 1,
      round: 1,
      rosterId: 1,
      playerId: 'historical-user',
      position: 'RB',
      isUserPick: true,
      isKeeper: false,
    },
    {
      pickNo: 2,
      round: 1,
      rosterId: 2,
      playerId: 'a',
      position: 'RB',
      isUserPick: false,
      isKeeper: false,
    },
    {
      pickNo: 3,
      round: 2,
      rosterId: 2,
      playerId: 'historical-opponent',
      position: 'QB',
      isUserPick: false,
      isKeeper: false,
    },
    {
      pickNo: 4,
      round: 2,
      rosterId: 1,
      playerId: 'historical-user-2',
      position: 'QB',
      isUserPick: true,
      isKeeper: false,
    },
  ],
};

const players = [
  player('a', 'RB', 1),
  player('b', 'RB', 2),
  player('c', 'QB', 3),
  player('d', 'QB', 4),
  player('e', 'RB', 5),
  player('f', 'QB', 6),
];

describe('counterfactual draft simulator', () => {
  it('removes a user selection before an opponent replacement pick', () => {
    const result = runCounterfactualDraft({
      season,
      priorSeasons: [],
      players,
      strategy: 'ecr',
      seed: 42,
    });

    expect(result.userPlayerIds[0]).toBe('a');
    expect(result.opponentPlayerIds).not.toContain('a');
    expect(new Set([...result.userPlayerIds, ...result.opponentPlayerIds]).size).toBe(4);
  });

  it('is repeatable for the same seed', () => {
    const first = simulateCounterfactualSeason({
      season,
      priorSeasons: [],
      players,
      strategy: 'model',
      iterations: 25,
      seed: 7,
    });
    const second = simulateCounterfactualSeason({
      season,
      priorSeasons: [],
      players,
      strategy: 'model',
      iterations: 25,
      seed: 7,
    });

    expect(first).toEqual(second);
  });

  it('reports interpolated 95% percentile intervals', () => {
    expect(estimateMetric([1, 2, 3, 4, 5])).toEqual({
      mean: 3,
      confidenceInterval: { level: 0.95, lower: 1.1, upper: 4.9 },
    });
  });
});
