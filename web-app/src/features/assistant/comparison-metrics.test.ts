import { describe, expect, it } from 'vitest';
import type { Recommendation } from '@fantasy-draft/shared';
import { comparisonBar, comparisonScale, getComparisonMetrics } from './comparison-metrics';

function recommendation(id: string, value: number, probability: number): Recommendation {
  return {
    playerId: id, playerName: id, position: 'RB', score: 0, reason: '',
    diagnostics: {
      expertRank: 10, marketRank: 12, marketDelta: 2,
      projectedPoints: 220, valueOverReplacement: value, tier: 2, tierRemaining: 3,
      nextPickSurvivalProbability: probability,
    },
  };
}

describe('comparison chart scales', () => {
  it('keeps both players on the same zero-based point scale', () => {
    const scale = comparisonScale([40, 80]);
    expect(comparisonBar(40, scale)).toEqual({ left: 0, width: 50, zero: 0 });
    expect(comparisonBar(80, scale)).toEqual({ left: 0, width: 100, zero: 0 });
  });

  it('draws negative positional value to the left of zero', () => {
    const scale = comparisonScale([-20, 60]);
    expect(comparisonBar(-20, scale)).toEqual({ left: 0, width: 25, zero: 25 });
    expect(comparisonBar(60, scale)).toEqual({ left: 25, width: 75, zero: 25 });
    expect(comparisonBar(-10, comparisonScale([-10, -20]))).toEqual({ left: 50, width: 50, zero: 100 });
  });

  it('distinguishes unavailable values from a genuine zero', () => {
    const scale = comparisonScale([null, 0]);
    expect(comparisonBar(null, scale)).toBeNull();
    expect(comparisonBar(Number.NaN, scale)).toBeNull();
    expect(comparisonBar(0, scale)).toEqual({ left: 0, width: 0, zero: 0 });
  });

  it('uses an absolute probability scale rather than stretching the larger chance to 100%', () => {
    const rows = getComparisonMetrics(recommendation('a', 10, 0.4), recommendation('b', 20, 0.8), new Map());
    const probability = rows.find(row => row.key === 'returnProbability');
    expect(probability?.values).toEqual([40, 80]);
    expect(probability?.scale).toEqual({ min: 0, max: 100 });
  });

  it('does not chart invalid probabilities or compare tiers across positions as a score', () => {
    const first = recommendation('a', 10, 1.2);
    const second: Recommendation = { ...recommendation('b', 20, Number.NaN), position: 'WR' };
    const rows = getComparisonMetrics(first, second, new Map([['a', 2], ['b', 1]]));
    expect(rows.find(row => row.key === 'returnProbability')?.values).toEqual([null, null]);
    expect(rows.find(row => row.key === 'tier')?.scale).toBeUndefined();
    expect(rows.find(row => row.key === 'tier')?.description).toBe('Tiers are relative to each position.');
    expect(rows.find(row => row.key === 'recommendationRank')?.values).toEqual([2, 1]);
  });

  it('keeps missing diagnostics unavailable', () => {
    const { diagnostics: _diagnostics, ...missing } = recommendation('a', 10, 0.4);
    const rows = getComparisonMetrics(missing, recommendation('b', 20, 0.8), new Map());
    expect(rows.every(row => row.values[0] === null)).toBe(true);
  });
});
