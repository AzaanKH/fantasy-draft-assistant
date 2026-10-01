import { describe, expect, it } from 'vitest';
import type { Player, PositionNeed } from '@fantasy-draft/shared';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { applyPositionTiers } from '@/lib/calculations/tiers';
import { getPositionalDepth, getAvailableDepthPlayers, getDepthPlayers, getDepthTiers, getDepthRosterOpenings, getDepthTierDrop } from './positional-depth';

describe('available positional depth', () => {
  it('excludes drafted and kept players without counting duplicate identities twice', () => {
    const rows = getPositionalDepth([
      { id: 'kept', position: 'WR', tier: 1 },
      { id: 'drafted', position: 'WR', tier: 2 },
      { id: 'available', position: 'WR', tier: 2 },
      { id: 'available', position: 'WR', tier: 2 },
      { id: 'later', position: 'WR', tier: 5 },
      { id: 'rb', position: 'RB', tier: 1 },
    ], new Set(['kept', 'drafted']));
    expect(rows.find((row) => row.position === 'WR')).toEqual({ position: 'WR', tier1: 0, tier2: 1, tier3: 0, other: 1, total: 2 });
    expect(rows.find((row) => row.position === 'RB')?.tier1).toBe(1);
  });
  it('shows empty positions and keeps unranked players out of early tiers', () => {
    const rows = getPositionalDepth([{ id: 'missing', position: 'TE', tier: NaN }], new Set());
    expect(rows.find((row) => row.position === 'QB')).toEqual({ position: 'QB', tier1: 0, tier2: 0, tier3: 0, other: 0, total: 0 });
    expect(rows.find((row) => row.position === 'TE')).toEqual({ position: 'TE', tier1: 0, tier2: 0, tier3: 0, other: 1, total: 1 });
  });
  it('represents the whole available pool even when most players are outside the first three tiers', () => {
    const positions = [
      { position: 'QB', tiers: [1, 9, 52, 0] },
      { position: 'RB', tiers: [2, 1, 4, 131] },
      { position: 'WR', tiers: [2, 1, 8, 165] },
      { position: 'TE', tiers: [1, 1, 8, 74] },
      { position: 'K', tiers: [2, 2, 6, 21] },
    ] as const;
    const players = positions.flatMap(({ position, tiers }) => tiers.flatMap((count, index) =>
      Array.from({ length: count }, (_, n) => ({ id: `${position}-${index}-${n}`, position, tier: index + 1 }))
    ));
    const rows = getPositionalDepth(players, new Set());
    for (const row of rows) {
      expect(row.tier1 + row.tier2 + row.tier3 + row.other).toBe(row.total);
    }
    expect(rows.find((row) => row.position === 'WR')?.total).toBe(176);
    expect(rows.find((row) => row.position === 'RB')?.total).toBe(138);
    expect(rows.find((row) => row.position === 'TE')?.total).toBe(84);
    expect(rows.find((row) => row.position === 'K')?.total).toBe(31);
  });

});

function player(id: string, overrides: Partial<Player> = {}): Player {
  const base = VISUAL_PLAYERS[0];
  if (!base) throw new Error('Missing player fixture');
  return { ...base, id, position: 'WR', tier: 1, ecrRank: 1, projectedPoints: 300, predictionSource: 'fantasypros', ...overrides };
}

describe('positional depth drilldowns', () => {
  it('shows exactly the available players counted in each tier, ordered by rank', () => {
    const input = [player('kept'), player('picked'), player('second', { ecrRank: 8 }),
      player('first', { ecrRank: 2 }), player('first', { ecrRank: 2 }), player('later', { tier: 5 })];
    const excluded = new Set(['kept', 'picked']);
    const available = getAvailableDepthPlayers(input, excluded);
    expect(getDepthPlayers(available, 'WR', 1).map((p) => p.id)).toEqual(['first', 'second']);
    expect(getDepthPlayers(available, 'WR', 'all')).toHaveLength(3);
    expect(getPositionalDepth(input, excluded).find((row) => row.position === 'WR')?.tier1).toBe(2);
    expect(input).toHaveLength(6);
  });

  it('keeps later and unranked players accessible without adding them to the first three tiers', () => {
    const players = [player('later', { tier: 6 }), player('missing', { tier: NaN }),
      player('invalid', { tier: 0 }), player('fractional', { tier: 1.5 })];
    expect(getDepthTiers(players, false)).toEqual([1, 2, 3]);
    expect(getDepthTiers(players, true)).toEqual([1, 2, 3, 6, 'unranked']);
    expect(getDepthPlayers(players, 'WR', 'unranked')).toHaveLength(3);
    expect(getDepthPlayers(players, 'WR', 1)).toEqual([]);
  });

  it('counts shared FLEX openings once, independently of fixed starter openings', () => {
    const needs: PositionNeed[] = (['RB', 'WR', 'TE'] as const).map((position) => ({
      position, startersNeeded: 2, startersFilled: position === 'WR' ? 1 : 2,
      flexSlotsNeeded: 2, flexSlotsFilled: 1, isFlexEligible: true, priority: 'high', scarcityScore: 5,
    }));
    const result = getDepthRosterOpenings(needs);
    expect(result.flex).toBe(1);
    expect([...result.fixed]).toEqual([['RB', 0], ['WR', 1], ['TE', 0]]);
    expect(getDepthRosterOpenings([]).flex).toBe(0);
  });

  it('measures the boundary to the next available tier, skipping an exhausted tier', () => {
    const players = [player('top'), player('bottom', { projectedPoints: 285 }),
      player('next', { tier: 3, projectedPoints: 260 }), player('next-bottom', { tier: 3, projectedPoints: 250 })];
    expect(getDepthTierDrop(players, 'WR', 1)).toEqual({ points: 25, nextTier: 3 });
    expect(getDepthTierDrop(players, 'WR', 3)).toBeNull();
    expect(getDepthTierDrop(players, 'WR', 'all')).toBeNull();
  });

  it.each([{ projectedPoints: NaN }, { predictionSource: 'heuristic' as const }])('withholds an unsupported tier drop: %o', (overrides) => {
    expect(getDepthTierDrop([player('top'), player('next', { tier: 2, projectedPoints: 260, ...overrides })], 'WR', 1)).toBeNull();
  });

  it('keeps the below-replacement QB group intact instead of treating a large count as high quality', () => {
    const players = applyPositionTiers([
      player('elite', { position: 'QB', projectedPoints: 400, valueOverReplacement: 100 }),
      ...Array.from({ length: 9 }, (_, i) => player(`starter-${i}`, {
        position: 'QB', projectedPoints: 350 - i, valueOverReplacement: 50 - i,
      })),
      ...Array.from({ length: 52 }, (_, i) => player(`reserve-${i}`, {
        position: 'QB', projectedPoints: 300 - i, valueOverReplacement: -i,
      })),
    ]);
    const reserves = getDepthPlayers(players, 'QB', 3);
    expect(reserves).toHaveLength(52);
    expect(reserves.filter((p) => p.valueOverReplacement > 0)).toHaveLength(0);
  });
});
