import { asProbability, asRank, asVor } from '../../units/brands.js';
import { describe, it, expect } from 'vitest';
import {
  calculatePositionalScarcity,
  calculateAllScarcityScores,
  ELITE_POSITIONAL_RANK_CUTOFFS,
  MAX_SCARCITY,
  MIN_SCARCITY,
} from './scarcity.js';
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

function scarcityWithEliteLeft(position: Player['position'], eliteLeft: number): number {
  return MAX_SCARCITY - (eliteLeft / ELITE_POSITIONAL_RANK_CUTOFFS[position]) * MAX_SCARCITY;
}

describe('ELITE_POSITIONAL_RANK_CUTOFFS', () => {
  it('has correct thresholds for each position', () => {
    expect(ELITE_POSITIONAL_RANK_CUTOFFS.QB).toBe(12);
    expect(ELITE_POSITIONAL_RANK_CUTOFFS.RB).toBe(24);
    expect(ELITE_POSITIONAL_RANK_CUTOFFS.WR).toBe(30);
    expect(ELITE_POSITIONAL_RANK_CUTOFFS.TE).toBe(10);
    expect(ELITE_POSITIONAL_RANK_CUTOFFS.K).toBe(12);
    expect(ELITE_POSITIONAL_RANK_CUTOFFS.DEF).toBe(12);
  });
});

describe('calculatePositionalScarcity', () => {
  describe('minimum scarcity (all elite players available)', () => {
    it('returns 1 when all elite QBs are available', () => {
      const players = createPlayersAtPosition('QB', 12, 1);
      const result = calculatePositionalScarcity('QB', players);
      expect(result).toBe(MIN_SCARCITY);
    });

    it('returns 1 when all elite RBs are available', () => {
      const players = createPlayersAtPosition('RB', 24, 1);
      const result = calculatePositionalScarcity('RB', players);
      expect(result).toBe(MIN_SCARCITY);
    });

    it('returns 1 when all elite TEs are available', () => {
      const players = createPlayersAtPosition('TE', 10, 1);
      const result = calculatePositionalScarcity('TE', players);
      expect(result).toBe(MIN_SCARCITY);
    });
  });

  describe('maximum scarcity (no elite players available)', () => {
    it('returns 10 when no elite QBs are available', () => {
      // All QBs have rank > 12
      const players = createPlayersAtPosition('QB', 10, 15);
      const result = calculatePositionalScarcity('QB', players);
      expect(result).toBe(MAX_SCARCITY);
    });

    it('returns 10 when no elite RBs are available', () => {
      const players = createPlayersAtPosition('RB', 10, 30);
      const result = calculatePositionalScarcity('RB', players);
      expect(result).toBe(MAX_SCARCITY);
    });
  });

  describe('partial scarcity', () => {
    it('returns middle value when half elite TEs are available', () => {
      const players = createPlayersAtPosition('TE', 5, 1);
      const result = calculatePositionalScarcity('TE', players);
      expect(result).toBe(scarcityWithEliteLeft('TE', 5));
    });

    it('returns high scarcity when few elite WRs remain', () => {
      const players = createPlayersAtPosition('WR', 6, 1);
      const result = calculatePositionalScarcity('WR', players);
      expect(result).toBe(scarcityWithEliteLeft('WR', 6));
    });

    it('ignores non-elite players in calculation', () => {
      // 5 elite TEs (rank 1-5) + 10 non-elite TEs (rank 11-20)
      const eliteTEs = createPlayersAtPosition('TE', 5, 1);
      const nonEliteTEs = createPlayersAtPosition('TE', 10, 11);
      const players = [...eliteTEs, ...nonEliteTEs];

      const result = calculatePositionalScarcity('TE', players);
      expect(result).toBe(scarcityWithEliteLeft('TE', 5));
    });

    it('uses positional rank instead of overall ECR rank', () => {
      const qbs = createPlayersAtPosition('QB', 12, 100).map((player, index) => ({
        ...player,
        positionalRank: asRank(index + 1),
      }));

      const result = calculatePositionalScarcity('QB', qbs);

      expect(result).toBe(MIN_SCARCITY);
    });

    it('only counts players at the specified position', () => {
      const qbs = createPlayersAtPosition('QB', 12, 1);
      const rbs = createPlayersAtPosition('RB', 24, 1);
      const players = [...qbs, ...rbs];

      const qbScarcity = calculatePositionalScarcity('QB', players);
      expect(qbScarcity).toBe(MIN_SCARCITY);

      const rbScarcity = calculatePositionalScarcity('RB', players);
      expect(rbScarcity).toBe(MIN_SCARCITY);
    });
  });

  describe('edge cases', () => {
    it('returns 10 when no players available', () => {
      const result = calculatePositionalScarcity('QB', []);
      expect(result).toBe(MAX_SCARCITY);
    });

    it('clamps result to minimum of 1', () => {
      const players = createPlayersAtPosition('QB', 20, 1);
      const result = calculatePositionalScarcity('QB', players);
      expect(result).toBeGreaterThanOrEqual(MIN_SCARCITY);
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

    expect(scores.get('QB')).toBe(scarcityWithEliteLeft('QB', 6));
    expect(scores.get('RB')).toBe(scarcityWithEliteLeft('RB', 12));
    expect(scores.get('TE')).toBe(scarcityWithEliteLeft('TE', 5));
  });
});
