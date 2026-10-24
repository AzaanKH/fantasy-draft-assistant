import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS, type Player, type RosterRequirements } from '@fantasy-draft/shared/league';
import type { DraftReadinessItem, DraftReadinessReport } from '@fantasy-draft/shared/catalog';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { filterDrafted } from '@fantasy-draft/shared/draft';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { describePausedAdvice, getPlayerPoolRows } from './player-pool-rows';

function player(index: number, position: Player['position'] = 'WR'): Player {
  const base = VISUAL_PLAYERS[0];
  if (!base) throw new Error('Missing player fixture');
  return { ...base, id: `p-${String(index)}`, name: `Player ${String(index)}`, team: 'DET', position, ecrRank: index };
}

function recommendation(source: Player): Recommendation {
  return { playerId: source.id, playerName: source.name, position: source.position, reason: 'Fit', score: 1 };
}

const pool = Array.from({ length: 120 }, (_, index) => player(index + 1, index % 2 === 0 ? 'WR' : 'RB'));
// The decision provider caps recommendations at 60.
const shortlist = pool.slice(0, 60).map(recommendation);

describe('getPlayerPoolRows', () => {
  it('finds an undrafted player outside the recommendation shortlist', () => {
    const rows = getPlayerPoolRows(pool, shortlist, 'ALL', 'player 101', DEFAULT_ROSTER_REQUIREMENTS);
    expect(rows.map((row) => row.player.id)).toEqual(['p-101']);
    expect(rows[0]?.recommendation).toBeUndefined();
  });

  it('lists recommended players first in recommendation order, then the rest by expert rank', () => {
    const reordered = [pool[4], pool[0]].flatMap((source) => source ? [recommendation(source)] : []);
    const rows = getPlayerPoolRows(pool.slice(0, 8), reordered, 'ALL', '', DEFAULT_ROSTER_REQUIREMENTS);
    expect(rows.map((row) => row.player.id)).toEqual(['p-5', 'p-1', 'p-2', 'p-3', 'p-4', 'p-6', 'p-7', 'p-8']);
    expect(rows[0]?.recommendation?.playerId).toBe('p-5');
  });

  it('keeps the whole pool browsable when recommendations are blocked', () => {
    expect(getPlayerPoolRows(pool, [], 'ALL', '', DEFAULT_ROSTER_REQUIREMENTS)).toHaveLength(120);
    expect(getPlayerPoolRows(pool, [], 'RB', '', DEFAULT_ROSTER_REQUIREMENTS).every((row) => row.player.position === 'RB')).toBe(true);
    expect(getPlayerPoolRows(pool, [], 'FLEX', '', DEFAULT_ROSTER_REQUIREMENTS)).toHaveLength(120);
  });

  it('filters FLEX by the league-configured eligibility, so superflex includes QBs', () => {
    const mixed = [player(1, 'QB'), player(2, 'RB'), player(3, 'K')];
    const superflex: RosterRequirements = {
      ...DEFAULT_ROSTER_REQUIREMENTS,
      FLEX: { starters: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
    };
    expect(getPlayerPoolRows(mixed, [], 'FLEX', '', superflex).map((row) => row.player.id)).toEqual(['p-1', 'p-2']);
    expect(getPlayerPoolRows(mixed, [], 'FLEX', '', DEFAULT_ROSTER_REQUIREMENTS).map((row) => row.player.id)).toEqual(['p-2']);
  });

  it('excludes drafted players from the canonical pool', () => {
    const undrafted = filterDrafted(pool, new Set(['p-101']), [{ playerName: 'Player 102', position: 'RB' }]);
    const rows = getPlayerPoolRows(undrafted, shortlist, 'ALL', 'player 10', DEFAULT_ROSTER_REQUIREMENTS);
    expect(rows.map((row) => row.player.id)).not.toContain('p-101');
    expect(rows.map((row) => row.player.id)).not.toContain('p-102');
    expect(rows.map((row) => row.player.id)).toContain('p-103');
  });
});

describe('describePausedAdvice', () => {
  function readiness(rankings: Partial<DraftReadinessItem>): DraftReadinessReport {
    return { coreDraftData: [{ key: 'trusted-rankings', ...rankings } as DraftReadinessItem] } as unknown as DraftReadinessReport;
  }

  it('dates the cached rankings when they are stale', () => {
    const message = describePausedAdvice(readiness({ problem: 'stale', timestamp: '2026-10-04T12:00:00Z', ageHours: 80 }), false);
    expect(message).toMatch(/rankings are out of date/);
    expect(message).toMatch(/3 days old/);
  });

  it('names provider identity and other setup blockers without a date', () => {
    expect(describePausedAdvice(null, true)).toMatch(/provider picks are matched/);
    expect(describePausedAdvice(readiness({ problem: null, timestamp: '2026-10-07T12:00:00Z', ageHours: 1 }), false)).toMatch(/until setup is finished/);
  });
});
