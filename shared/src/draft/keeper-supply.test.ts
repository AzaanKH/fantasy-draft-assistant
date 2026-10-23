import { type Player } from '../player.js';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeKeeperSupply,
  getEffectiveKeeperAssignments,
  isKeeperSupplyComplete,
} from './keeper-supply.js';

const TOTAL_TEAMS = 10;
const TOTAL_ROUNDS = 15;

function entry(
  playerId: string,
  playerName: string,
  position: Player['position'],
  teamIndex: number,
  round: number,
  isMyKeeper = false
) {
  return { playerId, playerName, position, teamIndex, round, isMyKeeper };
}

describe('canonicalizeKeeperSupply', () => {
  it('uses linear pick order when assigning and reconciling keeper reservations', () => {
    const supply = canonicalizeKeeperSupply([
      entry('keeper', 'Keeper', 'WR', 1, 2),
    ], { totalTeams: 10, totalRounds: 14, draftType: 'linear' });
    expect(supply.assignments[0]?.pickNumber).toBe(12);
    expect(getEffectiveKeeperAssignments(supply.assignments,
      [{ playerId: 'keeper', pickNumber: 12 }], 10, 'linear')).toEqual(supply.assignments);
    expect(getEffectiveKeeperAssignments(supply.assignments,
      [{ playerId: 'other', pickNumber: 12 }], 10, 'linear')).toEqual([]);
    expect(getEffectiveKeeperAssignments(supply.assignments,
      [{ playerId: 'other', pickNumber: 19 }], 10, 'linear')).toEqual(supply.assignments);
  });

  it('assigns each keeper its exact snake-draft selection at the configured round cost', () => {
    const supply = canonicalizeKeeperSupply([
      entry('jt', 'Jonathan Taylor', 'RB', 6, 1),
      entry('jsn', 'Jaxon Smith-Njigba', 'WR', 0, 2),
      entry('javonte', 'Javonte Williams', 'RB', 4, 10, true),
    ], { totalTeams: TOTAL_TEAMS, totalRounds: TOTAL_ROUNDS, draftType: 'snake' });

    expect(supply.duplicatePlayerIds).toEqual([]);
    expect(supply.invalidEntries).toEqual([]);
    expect(supply.conflictingEntries).toEqual([]);
    expect(supply.assignments.map((keeper) => [keeper.playerId, keeper.pickNumber])).toEqual([
      ['jt', 7],
      ['jsn', 20],
      ['javonte', 96],
    ]);
  });

  it('keeps one deterministic assignment per kept player when entries duplicate a player', () => {
    const supply = canonicalizeKeeperSupply([
      entry('dup', 'Duplicate Keeper', 'WR', 1, 3),
      entry('dup', 'Duplicate Keeper', 'WR', 1, 4),
      entry('other', 'Other Keeper', 'RB', 2, 5),
    ], { totalTeams: TOTAL_TEAMS, totalRounds: TOTAL_ROUNDS, draftType: 'snake' });

    expect(supply.duplicatePlayerIds).toEqual(['dup']);
    expect(supply.assignments.map((keeper) => [keeper.playerId, keeper.pickNumber])).toEqual([
      ['dup', 22],
      ['other', 43],
    ]);
  });

  it('drops entries outside the draft and resolves same-slot conflicts deterministically', () => {
    const supply = canonicalizeKeeperSupply([
      entry('late', 'Late Keeper', 'WR', 3, TOTAL_ROUNDS + 1),
      entry('bad-team', 'Bad Team Keeper', 'QB', TOTAL_TEAMS, 2),
      entry('slot-a', 'Slot A', 'RB', 2, 6),
      entry('slot-b', 'Slot B', 'TE', 2, 6),
    ], { totalTeams: TOTAL_TEAMS, totalRounds: TOTAL_ROUNDS, draftType: 'snake' });

    expect(supply.assignments.map((keeper) => keeper.playerId)).toEqual(['slot-a']);
    expect(supply.invalidEntries.map((keeper) => keeper.playerId)).toEqual([
      'late',
      'bad-team',
    ]);
    expect(supply.conflictingEntries.map((keeper) => keeper.playerId)).toEqual(['slot-b']);
  });

  it('requires the full current-season supply before mock recommendations can run', () => {
    const ready = {
      keepersEnabled: true,
      season: 2026,
      expectedSeason: 2026,
      isConfirmed: true,
      configuredCount: 10,
      expectedCount: 10,
      resolvedCount: 10,
      canonicalCount: 10,
      unresolvedNames: [],
      duplicateNames: [],
      invalidAssignments: [],
    } as const;

    expect(isKeeperSupplyComplete(ready)).toBe(true);
    expect(isKeeperSupplyComplete({ ...ready, season: 2025 })).toBe(false);
    expect(isKeeperSupplyComplete({ ...ready, configuredCount: 9 })).toBe(false);
    expect(isKeeperSupplyComplete({
      ...ready,
      canonicalCount: 9,
      invalidAssignments: ['Player, team 2, round 4'],
    })).toBe(false);
  });
});
