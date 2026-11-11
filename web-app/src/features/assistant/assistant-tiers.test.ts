import { asRank } from '@fantasy-draft/shared/units';
import { describe, expect, it } from 'vitest';

import { buildOverallBands, buildPositionTiers, countAvailableByTier, formatTierScarcity, isTierDepleted, tierKey, type TierPlayer } from './assistant-tiers';

const rb = (id: string, tier: number, ecrRank: number): TierPlayer => ({
  id, name: `Back ${id}`, position: 'RB', team: 'DET', tier, ecrRank: asRank(ecrRank),
});
const players: readonly TierPlayer[] = [
  rb('a', 1, 1), rb('b', 1, 2),
  rb('c', 2, 5), rb('d', 2, 4), rb('e', 2, 8), rb('f', 2, 9), rb('g', 2, 10), rb('h', 2, 11),
  rb('i', 3, 20),
  { id: 'wr', name: 'Receiver', position: 'WR', team: 'CIN', tier: 1, ecrRank: asRank(3) },
];
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
    id: `p${String(index + 1)}`, name: `Player ${String(index + 1)}`, position: index % 2 ? 'WR' : 'RB', team: 'DET', tier: 1, ecrRank: asRank(index + 1),
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
