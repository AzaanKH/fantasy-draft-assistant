import { describe, expect, it } from 'vitest';
import type { Player } from '@fantasy-draft/shared';
import {
  applyPositionTiers,
  calculateTierAvailability,
  getTierKey,
} from './tiers';

function createPlayer(
  id: string,
  projectedPoints: number,
  overrides: Partial<Player> = {}
): Player {
  return {
    id,
    name: id,
    position: 'WR',
    team: 'DET',
    byeWeek: 5,
    ecrRank: Number(id.replace(/\D/g, '')) || 1,
    positionalRank: Number(id.replace(/\D/g, '')) || 1,
    sleeperAdp: 1,
    valueScore: 0,
    marketRank: 1,
    marketAdp: 1,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints,
    valueOverReplacement: Math.max(0, projectedPoints - 250),
    tier: 1,
    tierDropoffScore: 0,
    nextPickSurvivalProbability: 0.5,
    ceilingScore: 6,
    floorScore: 5,
    upsideScore: 6,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'fantasypros',
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
    ...overrides,
  };
}

describe('applyPositionTiers', () => {
  it('creates a tier boundary at a meaningful within-position projection cliff', () => {
    const players = applyPositionTiers([
      createPlayer('wr1', 300),
      createPlayer('wr2', 298),
      createPlayer('wr3', 296, { fantasyProsTier: 2 }),
      createPlayer('wr4', 270),
      createPlayer('wr5', 268),
    ]);

    expect(players.map((player) => player.tier)).toEqual([1, 1, 1, 2, 2]);
    expect(players[2]?.tierDropoffPoints).toBe(26);
    expect(players[2]?.tierDropoffScore).toBe(1);
    expect(players[2]?.fantasyProsTier).toBe(2);
    expect(players[2]?.tierSource).toBe('league-projection');
  });

  it('keeps evenly spaced players together instead of inventing fixed-size tiers', () => {
    const players = applyPositionTiers([
      createPlayer('wr1', 300),
      createPlayer('wr2', 295),
      createPlayer('wr3', 290),
      createPlayer('wr4', 285),
      createPlayer('wr5', 280),
      createPlayer('wr6', 275),
      createPlayer('wr7', 270),
      createPlayer('wr8', 265),
    ]);

    expect(players.map((player) => player.tier)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1,
    ]);
  });

  it('labels ECR-derived projection proxies as a fallback', () => {
    const [player] = applyPositionTiers([
      createPlayer('wr1', 300, { predictionSource: 'heuristic' }),
      createPlayer('wr2', 290, { predictionSource: 'heuristic' }),
    ]);

    expect(player?.tierSource).toBe('ecr-fallback');
  });
});

describe('calculateTierAvailability', () => {
  it('counts only the supplied available players and measures the next-tier cliff', () => {
    const allPlayers = applyPositionTiers([
      createPlayer('wr1', 300),
      createPlayer('wr2', 298),
      createPlayer('wr3', 296),
      createPlayer('wr4', 270),
      createPlayer('wr5', 268),
    ]);
    const availablePlayers = allPlayers.filter((player) => player.id !== 'wr2');
    const summaries = calculateTierAvailability(availablePlayers);

    expect(summaries.get(getTierKey('WR', 1))).toMatchObject({
      remaining: 2,
      dropoffPoints: 26,
      nextTier: 2,
      nextTierProjectedPoints: 270,
      isMeaningfulCliff: true,
    });
    expect(summaries.get(getTierKey('WR', 2))).toMatchObject({
      remaining: 2,
      dropoffPoints: 0,
    });
  });

  it('does not call a small projection gap a meaningful cliff just because the tier number changes', () => {
    const summaries = calculateTierAvailability([
      createPlayer('wr1', 300, {
        tier: 1,
        tierDropoffScore: 0.8,
      }),
      createPlayer('wr2', 296, { tier: 2 }),
    ]);

    expect(summaries.get(getTierKey('WR', 1))).toMatchObject({
      remaining: 1,
      dropoffPoints: 4,
      nextTier: 2,
      nextTierProjectedPoints: 296,
      isMeaningfulCliff: false,
    });
  });

  it('keeps the live cliff meaningful after the original bottom-tier player is drafted', () => {
    const allPlayers = applyPositionTiers([
      createPlayer('wr1', 300),
      createPlayer('wr2', 298),
      createPlayer('wr3', 296),
      createPlayer('wr4', 270),
      createPlayer('wr5', 268),
    ]);
    const availablePlayers = allPlayers.filter((player) => player.id !== 'wr3');
    const summaries = calculateTierAvailability(availablePlayers);

    expect(summaries.get(getTierKey('WR', 1))).toMatchObject({
      remaining: 2,
      dropoffPoints: 28,
      nextTier: 2,
      isMeaningfulCliff: true,
    });
  });
});
