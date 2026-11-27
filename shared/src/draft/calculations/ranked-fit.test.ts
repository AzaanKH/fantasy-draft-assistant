import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS, type RosterRequirements } from '../../draft.js';
import { FLEX_GROUPS, type OffensivePosition, type Position } from '../../league/positions.js';
import {
  deriveRosterRules,
  isRankedFitLegal,
  missingRequiredSlots,
  rosterRulesFromRequirements,
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
  name: (player) => player.id,
  id: (player) => player.id,
  counts,
  rules: rules(bench),
  remainingPicksIncludingCurrent,
}).map((player) => player.id);

describe('Ranked Fit', () => {
  it('rescues a legal roster by skipping higher-ranked players who would leave a starting slot unfillable', () => {
    // Two RB slots and the FLEX are open with three selections left: a backup QB leaves them unfillable,
    // while an RB or a third WR (who fills FLEX) keeps the roster completable.
    const available = [candidate('qb', 'QB', 1), candidate('wr', 'WR', 2), candidate('rb-b', 'RB', 9), candidate('rb-a', 'RB', 5)];
    expect(order(available, { QB: 1, RB: 0, WR: 2, TE: 1 }, 3)).toEqual(['wr', 'rb-a', 'rb-b']);
    // FLEX already filled by a third WR and one pick left for the open RB slot: only an RB fits.
    expect(order(available, { QB: 1, RB: 1, WR: 3, TE: 1 }, 1)).toEqual(['rb-a', 'rb-b']);
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

  it('breaks expert-rank ties by name then ID, whatever the input order', () => {
    const available = [candidate('second', 'WR', 4), candidate('first', 'RB', 4)];
    expect(order(available, { QB: 0, RB: 0, WR: 0, TE: 0 }, 14)).toEqual(['first', 'second']);
    expect(order([...available].reverse(), { QB: 0, RB: 0, WR: 0, TE: 0 }, 14)).toEqual(['first', 'second']);
  });

  it('counts FLEX only from players beyond their own fixed starters', () => {
    // QB1 RB3 WR1 TE1 with one FLEX: the third RB fills FLEX and only the open WR slot is missing.
    const counts = { QB: 1, RB: 3, WR: 1, TE: 1 };
    expect(missingRequiredSlots(counts, rules(6))).toBe(1);
    // Two picks left: a backup QB still leaves one pick for the WR.
    expect(isRankedFitLegal('QB', counts, rules(6), 2)).toBe(true);
    expect(isRankedFitLegal('QB', counts, rules(6), 1)).toBe(false);
  });

  it('rejects every offensive player when no selection is left for one', () => {
    expect(isRankedFitLegal('QB', { QB: 1, RB: 2, WR: 2, TE: 1 }, rules(6), 0)).toBe(false);
  });
});

describe('league FLEX eligibility', () => {
  const filled = { QB: 1, RB: 2, WR: 2, TE: 1 };
  const withFlex = (eligiblePositions: readonly Position[]): RosterRequirements => ({
    ...DEFAULT_ROSTER_REQUIREMENTS,
    FLEX: { starters: 1, eligiblePositions },
  });

  it('keeps an eligible backup QB in a superflex league', () => {
    const superflex = rosterRulesFromRequirements(withFlex(FLEX_GROUPS.superflex));
    expect(isRankedFitLegal('QB', filled, superflex, 1)).toBe(true);
    expect(isRankedFitLegal('QB', filled, rosterRulesFromRequirements(withFlex(FLEX_GROUPS.standard)), 1)).toBe(false);
  });

  it('rejects an RB for a receiving-only FLEX', () => {
    const receiving = rosterRulesFromRequirements(withFlex(['WR', 'TE']));
    expect(isRankedFitLegal('RB', filled, receiving, 1)).toBe(false);
    expect(isRankedFitLegal('WR', filled, receiving, 1)).toBe(true);
  });

  it('keeps standard FLEX for historical slot labels', () => {
    expect(rules(0).flexPositions).toEqual(FLEX_GROUPS.standard);
  });
});

describe('live Ranked Fit', () => {
  interface LivePlayer { readonly id: string; readonly name: string; readonly position: Position; readonly ecrRank: number }
  const player = (id: string, position: Position, ecrRank: number): LivePlayer => ({ id, name: id, position, ecrRank });
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

  it('lists only the kicker once only reserved selections remain', () => {
    // Every offensive starter and both FLEX slots filled, DEF on the bench, one pick left for the required K.
    const context = {
      requirements: { ...DEFAULT_ROSTER_REQUIREMENTS, DEF: { starters: 0, max: 1 } },
      rosterCounts: { QB: 1, RB: 3, WR: 3, TE: 1, DEF: 1 },
      selectionsRemaining: 1,
    };
    expect(ids(orderLiveRankedFit([...pool, player('def', 'DEF', 5)], context))).toEqual(['k']);
  });

  it('rejects a kicker that would leave an open offensive starter unfillable', () => {
    // Two FLEX slots open with two picks left: drafting the kicker now leaves one pick for two slots.
    const context = {
      requirements: DEFAULT_ROSTER_REQUIREMENTS,
      rosterCounts: { QB: 1, RB: 2, WR: 2, TE: 1 },
      selectionsRemaining: 3,
    };
    expect(ids(orderLiveRankedFit(pool, context))).toEqual(['rb', 'wr', 'k']);
    expect(ids(orderLiveRankedFit(pool, { ...context, selectionsRemaining: 2 }))).toEqual([]);
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
