import { asProbability, asRank, asVor } from '../../units/brands.js';
import { describe, it, expect } from 'vitest';
import { calculatePositionalScarcity, calculateAllScarcityScores } from './scarcity.js';
import type { Player } from '../../player.js';

function createPlayer(id: string, position: Player['position'], ecrRank: number): Player {
  return {
    id,
    name: `Player ${id}`,
    position,
    team: 'DET',
    byeWeek: 6,
    ecrRank: asRank(ecrRank),
    positionalRank: asRank(ecrRank),
    sleeperAdp: ecrRank,
    valueScore: 0,
    marketRank: ecrRank,
    marketAdp: ecrRank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 200 - ecrRank,
    valueOverReplacement: asVor(Math.max(0, 20 - ecrRank / 5)),
    tier: 1,
    tierDropoffScore: 0.8,
    nextPickSurvivalProbability: asProbability(0.5),
    ceilingScore: 7,
    floorScore: 6,
    upsideScore: 6,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'heuristic',
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
  };
}

function createPlayersAtPosition(
  position: Player['position'],
  count: number,
  startingRank: number = 1
): Player[] {
  return Array.from({ length: count }, (_, i) =>
    createPlayer(`${position}-${i + 1}`, position, startingRank + i)
  );
}

describe('calculatePositionalScarcity', () => {
  it.each([
    ['clamps to 1 when every elite QB is available', 'QB', createPlayersAtPosition('QB', 20, 1), 1],
    ['returns 10 when no elite QB is left', 'QB', createPlayersAtPosition('QB', 10, 15), 10],
    ['returns 10 when no player is left', 'QB', [], 10],
    ['scales with the elite TEs left, ignoring non-elite ones', 'TE',
      [...createPlayersAtPosition('TE', 5, 1), ...createPlayersAtPosition('TE', 10, 11)], 5],
    ['scales against the WR cutoff', 'WR', createPlayersAtPosition('WR', 6, 1), 8],
    ['reads positional rank rather than overall ECR', 'QB',
      createPlayersAtPosition('QB', 12, 100).map((player, index) => ({ ...player, positionalRank: asRank(index + 1) })), 1],
  ] as const)('%s', (_label, position, players, expected) => {
    expect(calculatePositionalScarcity(position, players)).toBe(expected);
  });
});

describe('calculateAllScarcityScores', () => {
  it('scores every position from its own players only', () => {
    const players = [
      ...createPlayersAtPosition('QB', 6, 1),
      ...createPlayersAtPosition('RB', 12, 1),
      ...createPlayersAtPosition('WR', 15, 1),
      ...createPlayersAtPosition('TE', 5, 1),
      ...createPlayersAtPosition('K', 6, 1),
    ];

    expect(Object.fromEntries(calculateAllScarcityScores(players)))
      .toEqual({ QB: 5, RB: 5, WR: 5, TE: 5, K: 5, DEF: 10 });
  });
});
