import { describe, it, expect } from 'vitest';
import { getRecommendations, getTopRecommendation } from './recommendations';
import type { Player, PositionNeed } from '@fantasy-draft/shared';

// Helper to create a mock player
function createPlayer(
  id: string,
  position: Player['position'],
  ecrRank: number,
  name?: string
): Player {
  return {
    id,
    name: name ?? `Player ${id}`,
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

// Helper to create position needs
function createNeeds(
  needsConfig: Array<{
    position: Player['position'];
    priority: PositionNeed['priority'];
    scarcityScore?: number;
  }>
): PositionNeed[] {
  return needsConfig.map(({ position, priority, scarcityScore = 5 }) => ({
    position,
    priority,
    startersFilled: priority === 'critical' ? 0 : 1,
    startersNeeded: position === 'QB' ? 1 : 2,
    scarcityScore,
  }));
}

describe('getRecommendations', () => {
  describe('bestAvailable', () => {
    it('returns players sorted by ECR rank', () => {
      const players = [
        createPlayer('p3', 'WR', 30),
        createPlayer('p1', 'QB', 10),
        createPlayer('p2', 'RB', 20),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'low' },
        { position: 'RB', priority: 'low' },
        { position: 'WR', priority: 'low' },
      ]);

      const { bestAvailable } = getRecommendations(players, needs, 10);

      expect(bestAvailable[0]?.playerName).toBe('Player p1');
      expect(bestAvailable[0]?.reason).toContain('FP #10');
      expect(bestAvailable[1]?.playerName).toBe('Player p2');
      expect(bestAvailable[2]?.playerName).toBe('Player p3');
    });

    it('respects the limit parameter', () => {
      const players = Array.from({ length: 20 }, (_, i) =>
        createPlayer(`p${i + 1}`, 'WR', i + 1)
      );
      const needs = createNeeds([{ position: 'WR', priority: 'low' }]);

      const { bestAvailable } = getRecommendations(players, needs, 5);

      expect(bestAvailable).toHaveLength(5);
    });

    it('calculates a positive composite best-available score', () => {
      const players = [createPlayer('p1', 'QB', 15)];
      const needs = createNeeds([{ position: 'QB', priority: 'low' }]);

      const { bestAvailable } = getRecommendations(players, needs);

      expect(bestAvailable[0]?.score).toBeGreaterThan(0);
      expect(bestAvailable[0]?.subScores?.expertRankScore).toBeGreaterThan(0);
      expect(bestAvailable[0]?.diagnostics?.marketRank).toBe(15);
    });
  });

  describe('byNeed', () => {
    it('filters to critical and high priority positions', () => {
      const players = [
        createPlayer('p1', 'QB', 10),
        createPlayer('p2', 'RB', 15),
        createPlayer('p3', 'WR', 5),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical' },
        { position: 'RB', priority: 'low' },
        { position: 'WR', priority: 'filled' },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      expect(byNeed).toHaveLength(1);
      expect(byNeed[0]?.position).toBe('QB');
    });

    it('falls back to medium priority when no critical/high needs', () => {
      const players = [
        createPlayer('p1', 'QB', 10),
        createPlayer('p2', 'RB', 15),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'medium' },
        { position: 'RB', priority: 'low' },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      expect(byNeed).toHaveLength(1);
      expect(byNeed[0]?.position).toBe('QB');
    });

    it('applies need multiplier (2x for critical, 1.5x for high)', () => {
      const players = [
        createPlayer('p1', 'QB', 20),
        createPlayer('p2', 'RB', 20),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical', scarcityScore: 5 },
        { position: 'RB', priority: 'high', scarcityScore: 5 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      const qbRec = byNeed.find((r) => r.position === 'QB');
      const rbRec = byNeed.find((r) => r.position === 'RB');

      // Same ECR rank (20), so base score is 80
      // QB: 80 * 2 (critical) * 1.25 (scarcity 5 -> 1 + 5/20)
      // RB: 80 * 1.5 (high) * 1.25 (scarcity)
      expect(qbRec!.score).toBeGreaterThan(rbRec!.score);
    });

    it('applies scarcity multiplier', () => {
      const players = [
        createPlayer('p1', 'QB', 20),
        createPlayer('p2', 'TE', 20),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical', scarcityScore: 2 },
        { position: 'TE', priority: 'critical', scarcityScore: 9 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      const qbRec = byNeed.find((r) => r.position === 'QB');
      const teRec = byNeed.find((r) => r.position === 'TE');

      // TE should rank higher due to higher scarcity
      expect(teRec!.score).toBeGreaterThan(qbRec!.score);
    });

    it('applies TE premium boost (1.15x)', () => {
      const players = [
        createPlayer('p1', 'WR', 20),
        createPlayer('p2', 'TE', 20),
      ];
      const needs = createNeeds([
        { position: 'WR', priority: 'critical', scarcityScore: 5 },
        { position: 'TE', priority: 'critical', scarcityScore: 5 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      const wrRec = byNeed.find((r) => r.position === 'WR');
      const teRec = byNeed.find((r) => r.position === 'TE');

      // TE should rank higher due to TE premium
      expect(teRec!.score).toBeGreaterThan(wrRec!.score);
    });

    it('includes reason with priority and scarcity', () => {
      const players = [createPlayer('p1', 'RB', 10)];
      const needs = createNeeds([
        { position: 'RB', priority: 'critical', scarcityScore: 7.5 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      expect(byNeed[0]?.reason).toContain('critical need');
      expect(byNeed[0]?.reason).toContain('FP #10');
    });

    it('sorts by calculated score descending', () => {
      const players = [
        createPlayer('p1', 'QB', 50), // Lower base score
        createPlayer('p2', 'RB', 10), // Higher base score
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical', scarcityScore: 5 },
        { position: 'RB', priority: 'critical', scarcityScore: 5 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      expect(byNeed[0]?.position).toBe('RB'); // Higher score first
    });
  });

  describe('edge cases', () => {
    it('handles empty players array', () => {
      const needs = createNeeds([{ position: 'QB', priority: 'critical' }]);

      const { bestAvailable, byNeed } = getRecommendations([], needs);

      expect(bestAvailable).toHaveLength(0);
      expect(byNeed).toHaveLength(0);
    });

    it('handles empty needs array', () => {
      const players = [createPlayer('p1', 'QB', 10)];

      const { bestAvailable, byNeed } = getRecommendations(players, []);

      expect(bestAvailable).toHaveLength(1);
      expect(byNeed).toHaveLength(0);
    });
  });

  it('exposes named sub-scores on need-based recommendations', () => {
    const players = [createPlayer('p1', 'TE', 20)];
    const needs = createNeeds([{ position: 'TE', priority: 'critical', scarcityScore: 9 }]);

    const { byNeed } = getRecommendations(players, needs);

    expect(byNeed[0]?.subScores?.needMultiplier).toBe(2);
    expect(byNeed[0]?.subScores?.scarcityMultiplier).toBe(1.45);
    expect(byNeed[0]?.subScores?.tePremiumBoost).toBe(1.15);
  });
});

describe('getTopRecommendation', () => {
  it('returns top byNeed recommendation when available', () => {
    const players = [
      createPlayer('p1', 'QB', 10, 'Patrick Mahomes'),
      createPlayer('p2', 'RB', 5, 'Christian McCaffrey'),
    ];
    const needs = createNeeds([
      { position: 'QB', priority: 'critical' },
      { position: 'RB', priority: 'low' },
    ]);

    const result = getTopRecommendation(players, needs);

    expect(result?.playerName).toBe('Patrick Mahomes');
    expect(result?.position).toBe('QB');
  });

  it('falls back to bestAvailable when no need-based recommendations', () => {
    const players = [createPlayer('p1', 'QB', 10, 'Patrick Mahomes')];
    const needs = createNeeds([{ position: 'RB', priority: 'critical' }]);

    const result = getTopRecommendation(players, needs);

    expect(result?.playerName).toBe('Patrick Mahomes');
  });

  it('returns null when no players available', () => {
    const needs = createNeeds([{ position: 'QB', priority: 'critical' }]);

    const result = getTopRecommendation([], needs);

    expect(result).toBeNull();
  });
});
