import { describe, expect, it } from 'vitest';

import { buildPositionTiers, isTierDepleted, type TierPlayer } from './assistant-tiers';

const rb = (id: string, tier: number, ecrRank: number): TierPlayer => ({
  id, name: `Back ${id}`, position: 'RB', team: 'DET', tier, ecrRank,
});
const players: readonly TierPlayer[] = [
  rb('a', 1, 1), rb('b', 1, 2),
  rb('c', 2, 5), rb('d', 2, 4), rb('e', 2, 8), rb('f', 2, 9), rb('g', 2, 10), rb('h', 2, 11),
  rb('i', 3, 20),
  { id: 'wr', name: 'Receiver', position: 'WR', team: 'CIN', tier: 1, ecrRank: 3 },
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
