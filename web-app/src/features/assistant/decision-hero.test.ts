import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import type { Position } from '@fantasy-draft/shared/league';
import { describe, expect, it } from 'vitest';
import type { NextPickAvailability } from '@/lib/next-pick-availability';
import { getDisagreeingLens, getHeroStats, getSkipRow, shortPlayerName } from './decision-hero';

function rec(playerId: string, position: Position = 'WR', diagnostics: Partial<NonNullable<Recommendation['diagnostics']>> = {}): Recommendation {
  return {
    playerId,
    playerName: `First ${playerId}`,
    position,
    reason: 'ECR champion',
    score: 1,
    diagnostics: { expertRank: asRank(1), marketRank: 1, marketDelta: 0, projectedPoints: 200, valueOverReplacement: asVor(60), tier: 2, ...diagnostics },
  };
}

const estimate = (probability: number, pickLabel = '6.06'): NextPickAvailability => ({ kind: 'estimate', probability: asProbability(probability), pickLabel });

describe('getDisagreeingLens', () => {
  const a = rec('a');
  const b = rec('b');
  const c = rec('c');

  it('offers the first lens in toggle order whose top pick differs', () => {
    expect(getDisagreeingLens({ rankedFit: a, bestPick: b, bestPlayer: c }, 'ranked-fit')).toEqual({ lens: 'best-pick', recommendation: b });
    expect(getDisagreeingLens({ rankedFit: a, bestPick: a, bestPlayer: c }, 'ranked-fit')).toEqual({ lens: 'best-player', recommendation: c });
    expect(getDisagreeingLens({ rankedFit: a, bestPick: b, bestPlayer: b }, 'best-player')).toEqual({ lens: 'ranked-fit', recommendation: a });
  });

  it('is null when every lens agrees, so the hero offers Compare', () => {
    expect(getDisagreeingLens({ rankedFit: a, bestPick: a, bestPlayer: a }, 'best-pick')).toBeNull();
  });
});

describe('shortPlayerName', () => {
  it('uses the last name, skipping suffixes, and keeps a defense whole', () => {
    expect(shortPlayerName('Malik Hart')).toBe('Hart');
    expect(shortPlayerName('Marvin Harrison Jr.')).toBe('Harrison');
    expect(shortPlayerName('Houston Texans', 'DEF')).toBe('Houston Texans');
  });
});

describe('getHeroStats', () => {
  it('states gone-by, value over a fill-in and tier supply from the model', () => {
    const stats = getHeroStats(rec('a', 'WR', { tierRemaining: 2 }), estimate(0.18));
    expect(stats.map((stat) => [stat.value, stat.label])).toEqual([['82%', 'gone by 6.06'], ['+60', 'over fill-in'], ['Tier 2', '2 WRs left']]);
    expect(stats[0]?.urgent).toBe(true);
  });

  it('leaves out the gone-by figure without a survival estimate', () => {
    const stats = getHeroStats(rec('a', 'RB', { tierRemaining: 1 }), { kind: 'unestimated' });
    expect(stats.map((stat) => stat.key)).toEqual(['value', 'tier']);
    expect(stats[1]?.label).toBe('1 RB left');
  });
});

describe('getSkipRow', () => {
  const hero = rec('hero', 'WR');
  const rbs = [rec('rb1', 'RB'), rec('rb2', 'RB'), rec('rb3', 'RB'), rec('rb4', 'RB'), rec('rb5', 'RB')];

  it('names the next position in the lens and its players likely to last, in lens order', () => {
    const availabilityById = new Map<string, NextPickAvailability>([
      ['rb1', estimate(0.2)], ['rb2', estimate(0.55)], ['rb3', estimate(0.9)], ['rb4', { kind: 'unestimated' }], ['rb5', estimate(0.6)],
    ]);
    const row = getSkipRow({ hero, ranked: [hero, rec('wr2'), rbs[0] ?? hero], byPosition: { RB: rbs }, availabilityById });
    expect(row?.position).toBe('RB');
    expect(row?.players.map((player) => player.playerId)).toEqual(['rb2', 'rb3', 'rb5']);
  });

  it('is omitted when no estimate says anyone lasts', () => {
    expect(getSkipRow({ hero, ranked: [hero, rbs[0] ?? hero], byPosition: { RB: rbs }, availabilityById: new Map() })).toBeNull();
  });
});
