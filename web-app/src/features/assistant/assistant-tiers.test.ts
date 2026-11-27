import { asRank } from '@fantasy-draft/shared/units';
import { describe, expect, it } from 'vitest';

import {
  buildOverallBands, buildPositionTiers, countAvailableByTier, findBiggestCliff, findNextPickMark, formatTierScarcity, formatTierStatus,
  getTierStatus, isTierDepleted, tierDropPoints, tierKey, type SurvivalLookup, type TierPlayer,
} from './assistant-tiers';

const rb = (id: string, tier: number, ecrRank: number, projectedPoints = 0): TierPlayer => ({
  id, name: `Back ${id}`, position: 'RB', team: 'DET', tier, ecrRank: asRank(ecrRank), projectedPoints,
});
const players: readonly TierPlayer[] = [
  rb('a', 1, 1, 300), rb('b', 1, 2, 290),
  rb('c', 2, 5, 250), rb('d', 2, 4, 262), rb('e', 2, 8, 245), rb('f', 2, 9, 240), rb('g', 2, 10, 236), rb('h', 2, 11, 231),
  rb('i', 3, 20, 208),
  { id: 'wr', name: 'Receiver', position: 'WR', team: 'CIN', tier: 1, ecrRank: asRank(3), projectedPoints: 280 },
];
const survivalFrom = (odds: Readonly<Record<string, number>>): SurvivalLookup => (id) => odds[id];
const drafted = new Set(['a', 'b', 'e', 'f', 'g', 'h']);

describe('buildPositionTiers', () => {
  it('starts at the first tier with players left and keeps the original tier size', () => {
    const tiers = buildPositionTiers({ players, position: 'RB', draftedPlayerIds: drafted });

    expect(tiers.activeTier).toBe(2);
    expect(tiers.exhaustedTiers).toEqual([1]);
    expect(tiers.groups.map((group) => [group.tier, group.available, group.total])).toEqual([[2, 2, 6], [3, 1, 1]]);
    expect(tiers.groups[0]?.players.map((player) => player.id)).toEqual(['d', 'c']);
  });

  it('shows drafted players and exhausted tiers on request without changing counts', () => {
    const tiers = buildPositionTiers({ players, position: 'RB', draftedPlayerIds: drafted, showDrafted: true });
    expect(tiers.groups.map((group) => group.tier)).toEqual([1, 2, 3]);
    expect(tiers.groups[1]?.players).toHaveLength(6);
    expect(tiers.groups[1]?.available).toBe(2);
  });

  it('measures each tier break on undrafted players, and the drop ahead of the active tier', () => {
    const tiers = buildPositionTiers({ players, position: 'RB', draftedPlayerIds: drafted });
    // Tier 2's weakest undrafted back (c, 250) against tier 3's best (i, 208).
    expect(tiers.groups.map((group) => group.dropBefore)).toEqual([null, 42]);
    expect(tiers.activeDrop).toBe(42);
    expect(tiers.activeRemaining.map((player) => player.id)).toEqual(['d', 'c']);
  });

  it('measures a drafted-out tier on everyone who was in it, and drops no label across a tier a search hid', () => {
    const shown = buildPositionTiers({ players, position: 'RB', draftedPlayerIds: drafted, showDrafted: true });
    // Tier 1's weakest (b, 290) against tier 2's best undrafted (d, 262).
    expect(shown.groups.map((group) => group.dropBefore)).toEqual([null, 28, 42]);
    const searched = buildPositionTiers({ players, position: 'RB', draftedPlayerIds: new Set(), query: 'back a' });
    expect(searched.groups.map((group) => group.dropBefore)).toEqual([null]);
    const skipping = buildPositionTiers({ players, position: 'RB', draftedPlayerIds: new Set(), query: 'back i' });
    expect(skipping.groups.map((group) => [group.tier, group.dropBefore])).toEqual([[3, null]]);
  });

  it('measures past a drafted-out middle tier to the next tier with players left', () => {
    const roster = [rb('x', 1, 1, 300), rb('y', 2, 2, 290), rb('z', 3, 3, 240)];
    const tiers = buildPositionTiers({ players: roster, position: 'RB', draftedPlayerIds: new Set(['y']) });
    expect(tiers.activeDrop).toBe(60);
    expect(tiers.groups.map((group) => [group.tier, group.dropBefore])).toEqual([[1, null], [3, 60]]);
  });

  it('has no drop ahead of the last tier', () => {
    const tiers = buildPositionTiers({ players, position: 'WR', draftedPlayerIds: new Set() });
    expect(tiers.activeDrop).toBeNull();
  });

  it('filters listed players by search but not the denominators', () => {
    const tiers = buildPositionTiers({ players, position: 'RB', draftedPlayerIds: drafted, query: 'back d' });
    expect(tiers.groups).toHaveLength(1);
    expect(tiers.groups[0]?.players.map((player) => player.id)).toEqual(['d']);
    expect(tiers.groups[0]?.total).toBe(6);
  });
});

describe('isTierDepleted', () => {
  it('flags two or fewer players left when that is a third or less of the tier', () => {
    expect(isTierDepleted({ available: 2, total: 6 })).toBe(true);
    expect(isTierDepleted({ available: 2, total: 4 })).toBe(false);
    expect(isTierDepleted({ available: 0, total: 3 })).toBe(false);
  });
});

describe('buildOverallBands', () => {
  const overall: readonly TierPlayer[] = Array.from({ length: 7 }, (_, index) => ({
    id: `p${String(index + 1)}`, name: `Player ${String(index + 1)}`, position: index % 2 ? 'WR' : 'RB', team: 'DET', tier: 1, ecrRank: asRank(index + 1), projectedPoints: 0,
  }));

  it('bands the expert order by league size, skipping fully drafted bands but keeping counts', () => {
    const bands = buildOverallBands({ players: overall, draftedPlayerIds: new Set(['p1', 'p2', 'p3', 'p5']), bandSize: 3 });
    expect(bands.activeTier).toBe(2);
    expect(bands.exhaustedTiers).toEqual([1]);
    expect(bands.groups.map((band) => [band.label, band.available, band.total])).toEqual([['#4–6', 2, 3], ['#7–7', 1, 1]]);
    expect(bands.groups[0]?.players.map((player) => player.id)).toEqual(['p4', 'p6']);
  });

  it('shows drafted players on request and filters by search', () => {
    const drafted = new Set(['p1']);
    expect(buildOverallBands({ players: overall, draftedPlayerIds: drafted, bandSize: 3, showDrafted: true }).groups[0]?.players).toHaveLength(3);
    const searched = buildOverallBands({ players: overall, draftedPlayerIds: drafted, bandSize: 3, query: 'player 7' });
    expect(searched.groups.map((band) => band.players.map((player) => player.id))).toEqual([['p7']]);
  });
});

describe('countAvailableByTier', () => {
  it('counts available players per position tier and skips untiered players', () => {
    const counts = countAvailableByTier([
      { position: 'RB', tier: 2 }, { position: 'RB', tier: 2 }, { position: 'WR', tier: 2 }, { position: 'TE', tier: 0 },
    ]);
    expect(counts.get(tierKey('RB', 2))).toBe(2);
    expect(counts.get(tierKey('WR', 2))).toBe(1);
    expect(counts.has(tierKey('TE', 0))).toBe(false);
    expect(formatTierScarcity('RB', 2, 2)).toBe('2 left in RB T2');
  });
});

describe('tierDropPoints', () => {
  it('rounds the gap between the weakest player above and the strongest below, never negative', () => {
    expect(tierDropPoints([{ projectedPoints: 200.4 }, { projectedPoints: 190.2 }], [{ projectedPoints: 170.1 }])).toBe(20);
    expect(tierDropPoints([{ projectedPoints: 150 }], [{ projectedPoints: 155 }])).toBe(0);
    expect(tierDropPoints([], [{ projectedPoints: 155 }])).toBeNull();
  });
});

describe('findNextPickMark', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('sits before the first player more likely there than not, skipping rows without an estimate', () => {
    expect(findNextPickMark(rows, survivalFrom({ a: 0.1, c: 0.6 }))).toEqual({ kind: 'before', playerId: 'c' });
    expect(findNextPickMark(rows, survivalFrom({ a: 0.5 }))).toEqual({ kind: 'before', playerId: 'a' });
  });

  it('falls after the list when every estimate is gone, and is left out with no estimates', () => {
    expect(findNextPickMark(rows, survivalFrom({ a: 0.1, b: 0.49 }))).toEqual({ kind: 'after' });
    expect(findNextPickMark(rows, survivalFrom({}))).toBeNull();
  });
});

describe('getTierStatus', () => {
  const remaining = [{ id: 'a' }, { id: 'b' }];

  it('says the tier empties when nobody in it is likely there, and lasts otherwise', () => {
    const empties = getTierStatus(2, remaining, survivalFrom({ a: 0.2, b: 0.4 }));
    expect(empties).toEqual({ kind: 'empties', tier: 2 });
    expect(empties && formatTierStatus(empties, '6.06')).toBe('No Tier 2 player likely at 6.06');
    const lasts = getTierStatus(2, remaining, survivalFrom({ a: 0.2, b: 0.7 }));
    expect(lasts).toEqual({ kind: 'lasts', tier: 2, likely: 1 });
    expect(lasts && formatTierStatus(lasts, '6.06')).toBe('Tier 2 should last to 6.06');
  });

  it('falls back to the count with no estimates, and says nothing with no tier left', () => {
    const count = getTierStatus(3, remaining, survivalFrom({}));
    expect(count && formatTierStatus(count, null)).toBe('2 left in Tier 3');
    expect(getTierStatus(null, [], survivalFrom({}))).toBeNull();
  });
});

describe('findBiggestCliff', () => {
  it('names the steepest imminent drop and the largest at any other position', () => {
    expect(findBiggestCliff([
      { position: 'QB', activeTier: 2, activeDrop: 8 },
      { position: 'RB', activeTier: 2, activeDrop: 23 },
      { position: 'WR', activeTier: 3, activeDrop: 6 },
      { position: 'TE', activeTier: 4, activeDrop: null },
    ])).toEqual({ position: 'RB', tier: 2, points: 23, othersMax: 8 });
  });

  it('is null with no positive drop ahead, and has no comparison when one position has a drop', () => {
    expect(findBiggestCliff([{ position: 'QB', activeTier: 1, activeDrop: 0 }, { position: 'RB', activeTier: null, activeDrop: null }])).toBeNull();
    expect(findBiggestCliff([{ position: 'QB', activeTier: 1, activeDrop: 5 }])).toEqual({ position: 'QB', tier: 1, points: 5, othersMax: null });
  });
});
