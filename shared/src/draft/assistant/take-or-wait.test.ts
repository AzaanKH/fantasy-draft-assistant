import { describe, expect, it } from 'vitest';
import { asProbability } from '../../units/index.js';
import type { Recommendation } from '../../draft.js';
import {
  decideTakeOrWait,
  getComparisonPreference,
  getNextPickSurvival,
  getRecommendationDecision,
  MATERIAL_WAIT_COST,
  orderAnalysedRecommendations,
} from './take-or-wait.js';

const decide = (survival: number | undefined, costOfWaiting: number | null, tierEnds = false) =>
  decideTakeOrWait({ survival, nextPickLabel: '2.08', tierEnds, costOfWaiting });

const recommendation = (playerId: string, score: number, extra: Partial<Recommendation> = {}): Recommendation => ({
  playerId, playerName: playerId, position: 'RB', score, rank: 1, reason: '', scope: 'overall', lens: 'draftNow', ...extra,
} as Recommendation);

describe('decideTakeOrWait', () => {
  it('takes now below 50%, saying likely gone below 35%', () => {
    expect(decide(0.2, 1)).toEqual({ kind: 'take-now', basis: 'likely-gone', nextPickLabel: '2.08' });
    expect(decide(0.4, 1)?.basis).toBe('may-be-gone');
  });

  it('takes the last of a tier now below 70% only', () => {
    expect(decide(0.6, 1, true)?.basis).toBe('tier-end');
    expect(decide(0.8, 1, true)?.kind).toBe('can-wait');
  });

  it('reads a cost of exactly 0 with high availability as Can wait, never as a missing estimate', () => {
    expect(decide(0.95, 0)).toEqual({ kind: 'can-wait', basis: 'cost-small', nextPickLabel: '2.08' });
  });

  it('hedges at a material cost and when the cost is not estimated', () => {
    expect(decide(0.8, MATERIAL_WAIT_COST)?.basis).toBe('cost-material');
    expect(decide(0.8, MATERIAL_WAIT_COST - 0.01)?.kind).toBe('can-wait');
    expect(decide(0.8, null)?.basis).toBe('cost-unknown');
    expect(decide(0.8, Number.NaN)?.basis).toBe('cost-unknown');
  });

  it('gives no verdict without an estimate', () => {
    expect(decide(undefined, 1)).toBeNull();
    expect(decide(Number.NaN, 1)).toBeNull();
  });
});

describe('getRecommendationDecision', () => {
  it('has no verdict on the final pick, where the model leaves out the next pick number', () => {
    const final = recommendation('a', 1, { diagnostics: { nextPickSurvivalProbability: asProbability(0.9), survivalModelSource: 'heuristic' } as never });
    expect(getNextPickSurvival(final)).toBeUndefined();
    expect(getRecommendationDecision(final)).toBeNull();
  });

  it('reads a zero cost from the draft timing as Can wait', () => {
    const free = recommendation('a', 1, {
      diagnostics: { nextPickSurvivalProbability: asProbability(0.9), nextPickNumber: 20, nextPickLabel: '2.08' } as never,
      decisionFactors: { draftTiming: { returnProbability: asProbability(0.9), nextPickLabel: '2.08', costOfWaiting: 0 } } as never,
    });
    expect(getRecommendationDecision(free)?.kind).toBe('can-wait');
  });
});

describe('Compare preference', () => {
  const first = recommendation('first', 10);
  const second = recommendation('second', 20);

  it('prefers the better overall rank, whatever the scores', () => {
    const ranks = new Map([['first', 2], ['second', 5]]);
    expect(getComparisonPreference({ rankByPlayerId: ranks }, first, second).preferred.playerId).toBe('first');
    expect(getComparisonPreference({ rankByPlayerId: new Map([['second', 3]]) }, first, second).preferred.playerId).toBe('second');
  });

  it('falls back to the model score when neither is in the overall order, and keeps the first on a tie', () => {
    expect(getComparisonPreference({ rankByPlayerId: new Map() }, first, second)).toEqual({ preferred: second, other: first });
    expect(getComparisonPreference({ rankByPlayerId: new Map() }, first, recommendation('tie', 10)).preferred.playerId).toBe('first');
  });

  it('offers the overall order first, then everyone else by score and then name', () => {
    const overall = [recommendation('o1', 1), recommendation('o2', 0)];
    const ordered = orderAnalysedRecommendations(overall, [overall[1]!, recommendation('b', 5), recommendation('a', 5), recommendation('c', 9)]);
    expect(ordered.map((item) => item.playerId)).toEqual(['o1', 'o2', 'c', 'a', 'b']);
  });
});
