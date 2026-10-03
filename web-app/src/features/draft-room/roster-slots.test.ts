import { DEFAULT_ROSTER_REQUIREMENTS, type Position } from '@fantasy-draft/shared';
import { describe, expect, it } from 'vitest';
import { getRosterSlots } from './roster-slots';

function roster(entries: Partial<Record<Position, string[]>>): Record<Position, string[]> {
  return { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [], ...entries };
}

describe('getRosterSlots', () => {
  it('lists every lineup slot in order before any player is drafted', () => {
    expect(getRosterSlots(roster({}), DEFAULT_ROSTER_REQUIREMENTS).map((slot) => slot.label)).toEqual([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'BN', 'BN', 'BN', 'BN', 'BN',
    ]);
  });

  it('moves eligible overflow into FLEX before the bench', () => {
    const slots = getRosterSlots(
      roster({ QB: ['qb1', 'qb2'], RB: ['rb1', 'rb2', 'rb3'], WR: ['wr1'] }),
      DEFAULT_ROSTER_REQUIREMENTS
    );
    expect(slots.filter((slot) => slot.label === 'FLEX').map((slot) => slot.playerId)).toEqual(['rb3', null]);
    expect(slots.find((slot) => slot.label === 'BN')?.playerId).toBe('qb2');
  });

  it('keeps players beyond the bench allowance visible', () => {
    const slots = getRosterSlots(
      roster({ QB: ['qb1', 'qb2', 'qb3', 'qb4', 'qb5', 'qb6', 'qb7'] }),
      DEFAULT_ROSTER_REQUIREMENTS
    );
    expect(slots.filter((slot) => slot.label === 'BN').map((slot) => slot.playerId)).toEqual([
      'qb2', 'qb3', 'qb4', 'qb5', 'qb6', 'qb7',
    ]);
  });
});
