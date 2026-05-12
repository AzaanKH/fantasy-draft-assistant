import { describe, it, expect } from 'vitest';
import {
  calculatePositionalScarcity,
  calculateAllScarcityScores,
  ELITE_THRESHOLDS,
} from './scarcity';
import type { Player } from '@fantasy-draft/shared';

// Helper to create a mock player
function createPlayer(id: string, position: Player['position'], ecrRank: number): Player {
  return {
    id,
    name: `Player ${id}`,
    position,
    team: 'DET',
    byeWeek: 6,
    ecrRank,
    sleeperAdp: ecrRank,
    valueScore: 0,
    marketRank: ecrRank,
    marketAdp: ecrRank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 200 - ecrRank,
    valueOverReplacement: Math.max(0, 20 - ecrRank / 5),
    tier: 1,
    tierDropoffScore: 0.8,
    nextPickSurvivalProbability: 0.5,
    ceilingScore: 7,
    floorScore: 6,
    upsideScore: 6,
    injuryRiskScore: 2,
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
  };
}

// Helper to create multiple players at a position
function createPlayersAtPosition(
  position: Player['position'],
  count: number,
  startingRank: number = 1
): Player[] {
  return Array.from({ length: count }, (_, i) =>
    createPlayer(`${position}-${i + 1}`, position, startingRank + i)
  );
}

describe('ELITE_THRESHOLDS', () => {
  it('has correct thresholds for each position', () => {
    expect(ELITE_THRESHOLDS.QB).toBe(12);
    expect(ELITE_THRESHOLDS.RB).toBe(24);
    expect(ELITE_THRESHOLDS.WR).toBe(30);
    expect(ELITE_THRESHOLDS.TE).toBe(10);
    expect(ELITE_THRESHOLDS.K).toBe(12);
    expect(ELITE_THRESHOLDS.DEF).toBe(12);
  });
});

describe('calculatePositionalScarcity', () => {
  describe('minimum scarcity (all elite players available)', () => {
    it('returns 1 when all elite QBs are available', () => {
      const players = createPlayersAtPosition('QB', 12, 1);
      const result = calculatePositionalScarcity('QB', players);
      expect(result).toBe(1);
    });

    it('returns 1 when all elite RBs are available', () => {
      const players = createPlayersAtPosition('RB', 24, 1);
      const result = calculatePositionalScarcity('RB', players);
      expect(result).toBe(1);
    });

    it('returns 1 when all elite TEs are available', () => {
      const players = createPlayersAtPosition('TE', 10, 1);
      const result = calculatePositionalScarcity('TE', players);
      expect(result).toBe(1);
    });
  });

  describe('maximum scarcity (no elite players available)', () => {
    it('returns 10 when no elite QBs are available', () => {
      // All QBs have rank > 12
      const players = createPlayersAtPosition('QB', 10, 15);
      const result = calculatePositionalScarcity('QB', players);
      expect(result).toBe(10);
    });

    it('returns 10 when no elite RBs are available', () => {
      const players = createPlayersAtPosition('RB', 10, 30);
      const result = calculatePositionalScarcity('RB', players);
      expect(result).toBe(10);
    });
  });

  describe('partial scarcity', () => {
    it('returns middle value when half elite TEs are available', () => {
      // 5 out of 10 elite TEs available
      const players = createPlayersAtPosition('TE', 5, 1);
      const result = calculatePositionalScarcity('TE', players);
      expect(result).toBe(5); // 10 - (5/10)*10 = 5
    });

    it('returns high scarcity when few elite WRs remain', () => {
      // 6 out of 30 elite WRs available
      const players = createPlayersAtPosition('WR', 6, 1);
      const result = calculatePositionalScarcity('WR', players);
      expect(result).toBe(8); // 10 - (6/30)*10 = 8
    });

    it('ignores non-elite players in calculation', () => {
      // 5 elite TEs (rank 1-5) + 10 non-elite TEs (rank 11-20)
      const eliteTEs = createPlayersAtPosition('TE', 5, 1);
      const nonEliteTEs = createPlayersAtPosition('TE', 10, 11);
      const players = [...eliteTEs, ...nonEliteTEs];

      const result = calculatePositionalScarcity('TE', players);
      expect(result).toBe(5); // Only counts the 5 elite TEs
    });

    it('only counts players at the specified position', () => {
      const qbs = createPlayersAtPosition('QB', 12, 1);
      const rbs = createPlayersAtPosition('RB', 24, 1);
      const players = [...qbs, ...rbs];

      // QB scarcity should only count QBs
      const qbScarcity = calculatePositionalScarcity('QB', players);
      expect(qbScarcity).toBe(1);

      // RB scarcity should only count RBs
      const rbScarcity = calculatePositionalScarcity('RB', players);
      expect(rbScarcity).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('returns 10 when no players available', () => {
      const result = calculatePositionalScarcity('QB', []);
      expect(result).toBe(10);
    });

    it('clamps result to minimum of 1', () => {
      // Even with more than threshold elite players, min is 1
      const players = createPlayersAtPosition('QB', 20, 1);
      const result = calculatePositionalScarcity('QB', players);
      expect(result).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('calculateAllScarcityScores', () => {
  it('returns scores for all positions', () => {
    const players = [
      ...createPlayersAtPosition('QB', 6, 1),
      ...createPlayersAtPosition('RB', 12, 1),
      ...createPlayersAtPosition('WR', 15, 1),
      ...createPlayersAtPosition('TE', 5, 1),
      ...createPlayersAtPosition('K', 6, 1),
      ...createPlayersAtPosition('DEF', 6, 1),
    ];

    const scores = calculateAllScarcityScores(players);

    expect(scores.size).toBe(6);
    expect(scores.has('QB')).toBe(true);
    expect(scores.has('RB')).toBe(true);
    expect(scores.has('WR')).toBe(true);
    expect(scores.has('TE')).toBe(true);
    expect(scores.has('K')).toBe(true);
    expect(scores.has('DEF')).toBe(true);

    // QB: 6/12 elite = scarcity 5
    expect(scores.get('QB')).toBe(5);
    // RB: 12/24 elite = scarcity 5
    expect(scores.get('RB')).toBe(5);
    // TE: 5/10 elite = scarcity 5
    expect(scores.get('TE')).toBe(5);
  });
});
