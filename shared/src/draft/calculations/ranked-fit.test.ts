import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS } from '../../draft.js';
import type { OffensivePosition, Position } from '../../league/positions.js';
import {
  deriveRosterRules,
  isRankedFitLegal,
  orderLiveRankedFit,
  orderRankedFit,
  type OffensiveRosterCounts,
} from './ranked-fit.js';

interface Candidate {
  readonly id: string;
  readonly position: OffensivePosition;
  readonly ecr: number;
}

const candidate = (id: string, position: OffensivePosition, ecr: number): Candidate => ({ id, position, ecr });

/** 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX and the given bench. */
const rules = (bench: number) => deriveRosterRules([
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', ...Array.from({ length: bench }, () => 'BN'),
]);

const order = (
  available: readonly Candidate[],
  counts: OffensiveRosterCounts,
  remainingPicksIncludingCurrent: number,
  bench = 6
) => orderRankedFit(available, {
  position: (player) => player.position,
  expertRank: (player) => player.ecr,
  counts,
  rules: rules(bench),
  remainingPicksIncludingCurrent,
}).map((player) => player.id);

describe('Ranked Fit', () => {
  it('rescues a legal roster by skipping higher-ranked players who would leave a starting slot unfillable', () => {
    // Two RB slots and the FLEX are open with three selections left: only an RB keeps the roster completable.
    const available = [candidate('qb', 'QB', 1), candidate('wr', 'WR', 2), candidate('rb-b', 'RB', 9), candidate('rb-a', 'RB', 5)];
    expect(order(available, { QB: 1, RB: 0, WR: 2, TE: 1 }, 3)).toEqual(['rb-a', 'rb-b']);
    // With a spare selection every position is legal again and ECR alone orders them.
    expect(order(available, { QB: 1, RB: 0, WR: 2, TE: 1 }, 4)).toEqual(['qb', 'wr', 'rb-a', 'rb-b']);
  });

  it('keeps a legal surplus starter at its ECR place, as the backtest row does', () => {
    // A backup QB while RB, WR and TE holes remain: Best Pick lists it last, Ranked Fit does not demote it.
    const available = [candidate('wr', 'WR', 3), candidate('backup-qb', 'QB', 2), candidate('rb', 'RB', 1)];
    expect(order(available, { QB: 1, RB: 0, WR: 0, TE: 0 }, 12)).toEqual(['rb', 'backup-qb', 'wr']);
  });

  it('excludes a position at its maximum and every player once the roster is full', () => {
    const counts = { QB: 1, RB: 2, WR: 2, TE: 3 };
    expect(isRankedFitLegal('TE', counts, rules(6), 10)).toBe(false);
    expect(isRankedFitLegal('WR', counts, rules(6), 10)).toBe(true);
    expect(isRankedFitLegal('WR', { QB: 1, RB: 3, WR: 3, TE: 1 }, rules(1), 5)).toBe(false);
  });

  it('keeps input order between players with the same expert rank', () => {
    const available = [candidate('second', 'WR', 4), candidate('first', 'RB', 4)];
    expect(order(available, { QB: 0, RB: 0, WR: 0, TE: 0 }, 14)).toEqual(['second', 'first']);
  });
});

describe('live Ranked Fit', () => {
  interface LivePlayer { readonly id: string; readonly position: Position; readonly ecrRank: number }
  const player = (id: string, position: Position, ecrRank: number): LivePlayer => ({ id, position, ecrRank });
  const pool = [player('k', 'K', 1), player('qb', 'QB', 2), player('rb', 'RB', 3), player('wr', 'WR', 4)];
  const ids = (players: readonly LivePlayer[]) => players.map((item) => item.id);

  it('is plain ECR without roster requirements', () => {
    expect(ids(orderLiveRankedFit(pool, undefined))).toEqual(['k', 'qb', 'rb', 'wr']);
  });

  it('reserves open kicker slots and lists the kicker after legal offensive players', () => {
    const context = {
      requirements: DEFAULT_ROSTER_REQUIREMENTS,
      rosterCounts: { QB: 1, RB: 2, WR: 2, TE: 1 },
      selectionsRemaining: 8,
    };
    expect(ids(orderLiveRankedFit(pool, context))).toEqual(['qb', 'rb', 'wr', 'k']);
  });

  it('lists the kicker first once only reserved selections remain', () => {
    const context = {
      requirements: DEFAULT_ROSTER_REQUIREMENTS,
      rosterCounts: { QB: 1, RB: 2, WR: 2, TE: 1 },
      selectionsRemaining: 1,
    };
    expect(ids(orderLiveRankedFit(pool, context))[0]).toBe('k');
  });

  it('uses the league position maximums', () => {
    const context = {
      requirements: { ...DEFAULT_ROSTER_REQUIREMENTS, QB: { starters: 1, max: 1 } },
      rosterCounts: { QB: 1 },
      selectionsRemaining: 14,
    };
    expect(ids(orderLiveRankedFit(pool, context))).not.toContain('qb');
  });
});
