import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import type { PositionNeed, Recommendation, RecommendationDecisionFactors } from '@fantasy-draft/shared/draft';
import type { Position } from '@fantasy-draft/shared/league';
import { describe, expect, it } from 'vitest';
import type { NextPickAvailability } from '@/lib/next-pick-availability';
import { getDisagreeingLens, getHeroReason, getHeroStats, getSkipRow, getSkipRowLabel, shortPlayerName } from './decision-hero';

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

function decisionFactors(): RecommendationDecisionFactors {
  return {
    playerQuality: { ecrRank: asRank(8), score: -8 },
    leagueValue: {
      score: 2,
      minScore: 0,
      maxScore: 6,
      projectedPoints: 240,
      replacementPoints: 200,
      valueOverReplacement: asVor(40),
      materiallyChangedOrdering: false,
    },
    rosterFit: {
      score: 6,
      minScore: 0,
      maxScore: 8,
      fixedStartersOpen: 2,
      flexSlotsOpen: 1,
      benchSlotsOpen: 5,
      selectionsRemaining: 8,
      legalCompletionPossible: true,
      materiallyChangedOrdering: false,
    },
    depthValue: {
      score: 0,
      minScore: 0,
      maxScore: 4,
      positionCount: 0,
      startersAtPosition: 0,
      reserveCount: 0,
      targetReserveCount: 2,
      reserveDeficit: 2,
      contingencyPoints: 0,
      materiallyChangedOrdering: false,
    },
    tierSupply: {
      score: 3,
      minScore: 0,
      maxScore: 4,
      currentTier: 2,
      remainingInTier: 1,
      nextTier: 3,
      nextTierProjectedPoints: 220,
      dropoffPoints: 20,
      meaningfulCliff: true,
      costOfWaiting: 3,
      materiallyChangedOrdering: false,
    },
    draftTiming: {
      score: 4,
      minScore: 0,
      maxScore: 4,
      nextPickNumber: 25,
      nextPickLabel: '3.05',
      picksUntilNextPick: 10,
      returnProbability: asProbability(0.18),
      candidateValue: 40,
      costOfWaiting: 16.5,
      materiallyChangedOrdering: false,
    },
    conservativeBoundary: {
      ecrRankLimit: asRank(9),
      samePositionTier: false,
      withinBoundary: true,
      feasibilityException: false,
    },
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

describe('getHeroReason', () => {
  const need = (change: Partial<PositionNeed> = {}): PositionNeed => ({
    position: 'RB', priority: 'medium', startersNeeded: 2, startersFilled: 2, flexSlotsNeeded: 1, flexSlotsFilled: 1, isFlexEligible: true, scarcityScore: 0, ...change,
  });
  const withFactors = (change: (factors: RecommendationDecisionFactors) => RecommendationDecisionFactors = (factors) => factors): Recommendation => ({
    ...rec('a', 'RB', { expertRank: asRank(47) }),
    decisionFactors: change(decisionFactors()),
  });
  const moved = (key: 'draftTiming' | 'tierSupply' | 'rosterFit' | 'depthValue' | 'leagueValue') => (factors: RecommendationDecisionFactors): RecommendationDecisionFactors => ({
    ...factors,
    [key]: { ...factors[key], materiallyChangedOrdering: true },
  });

  it('says what Ranked Fit and Best Player rank by, with the overall rank, never model names', () => {
    expect(getHeroReason(withFactors(), 'ranked-fit')).toBe('Highest-ranked player who still fits your roster, #47 overall');
    expect(getHeroReason(withFactors(), 'best-player')).toBe('Highest-ranked player left on the board, #47 overall');
  });

  it('states the Best Pick factor that decided the pick, in plain words', () => {
    expect(getHeroReason(withFactors(moved('draftTiming')), 'best-pick')).toBe('Waiting until 3.05 costs about 17 points');
    expect(getHeroReason(withFactors(moved('tierSupply')), 'best-pick')).toBe('Last RB in Tier 2 before a 20-point drop');
    expect(getHeroReason(withFactors(moved('rosterFit')), 'best-pick', null, need({ startersFilled: 0 }))).toBe('Fills one of your 2 open RB starting spots');
    expect(getHeroReason(withFactors(moved('depthValue')), 'best-pick')).toBe('Adds RB depth: you have 0 of 2 backups');
    expect(getHeroReason(withFactors(moved('leagueValue')), 'best-pick')).toBe('Projects +60 points over a fill-in RB in your scoring');
    expect(getHeroReason(withFactors(), 'best-pick')).toBe('Projects +60 points over a fill-in RB, #47 overall');
    // The divergence factor (why Best Pick differs from Ranked Fit) wins over the factors' own order.
    expect(getHeroReason(withFactors(moved('draftTiming')), 'best-pick', 'roster-fit', need({ startersFilled: 1 }))).toBe('Fills your open RB starting spot');
  });

  it('keeps a roster-completion pick in plain words, and falls back to value without factors', () => {
    const feasibility = withFactors((factors) => ({ ...factors, conservativeBoundary: { ...factors.conservativeBoundary, feasibilityException: true } }));
    expect(getHeroReason(feasibility, 'best-pick')).toBe('Keeps your roster fillable with 8 picks left');
    expect(getHeroReason(rec('a', 'WR'), 'best-pick')).toBe('Projects +60 points over a fill-in WR, #1 overall');
  });

  it('never claims a starting spot the pick cannot fill, and falls through to the next deciding factor', () => {
    // A bench RB while the open starter slot is a TE: both RB starters and the FLEX are filled.
    const full = need();
    expect(getHeroReason(withFactors(moved('rosterFit')), 'best-pick', null, full)).toBe('Projects +60 points over a fill-in RB, #47 overall');
    expect(getHeroReason(withFactors(moved('draftTiming')), 'best-pick', 'roster-fit', full)).toBe('Waiting until 3.05 costs about 17 points');
    // Without the team's needs the slot cannot be checked, so the line never claims one.
    expect(getHeroReason(withFactors(moved('rosterFit')), 'best-pick')).toBe('Projects +60 points over a fill-in RB, #47 overall');
    // A FLEX it can fill still counts; one it cannot does not.
    expect(getHeroReason(withFactors(moved('rosterFit')), 'best-pick', null, need({ flexSlotsFilled: 0 }))).toBe('Fills your open FLEX spot');
    expect(getHeroReason(withFactors(moved('rosterFit')), 'best-pick', null, need({ flexSlotsFilled: 0, isFlexEligible: false }))).toBe('Projects +60 points over a fill-in RB, #47 overall');
  });

  it('states the same value over a fill-in as the stat beside it', () => {
    const recommendation = withFactors(moved('leagueValue'));
    const stat = getHeroStats(recommendation, { kind: 'unestimated' }).find((item) => item.key === 'value');
    expect(stat?.value).toBe('+60');
    expect(getHeroReason(recommendation, 'best-pick')).toContain('+60 points');
  });
});

describe('getSkipRowLabel', () => {
  it('offers the skip only on the clock; while waiting it says who should last to your pick', () => {
    expect(getSkipRowLabel('RB', '6.06', true)).toBe('Skip RB now? Still there at 6.06:');
    expect(getSkipRowLabel('RB', '6.06', false)).toBe('Likely there at 6.06:');
  });
});
