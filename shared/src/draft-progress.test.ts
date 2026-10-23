import { describe, expect, it } from 'vitest';
import { deriveDraftCursor, type DraftProgress } from './draft-progress.js';

const cases: readonly { name: string; progress: DraftProgress; picks: readonly number[]; cursor: number }[] = [
  { name: 'pauses initially before an unconsumed keeper', progress: { anchor: { kind: 'start' }, historyLength: 0 }, picks: [], cursor: 1 },
  { name: 'advances a consumed keeper once', progress: { anchor: { kind: 'start' }, historyLength: 0 }, picks: [1], cursor: 2 },
  { name: 'honors a sparse explicit import', progress: { anchor: { kind: 'start' }, historyLength: 0 }, picks: [40], cursor: 41 },
  { name: 'branches across empty history', progress: { anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 0 }, picks: [], cursor: 96 },
  { name: 'does not move backward for an earlier explicit import', progress: { anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 0 }, picks: [4], cursor: 96 },
  { name: 'advances a keeper consumed after a branch', progress: { anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 0 }, picks: [96], cursor: 97 },
  { name: 'reopens an undone sparse pick', progress: { anchor: { kind: 'reopen', pickNumber: 40 }, historyLength: 1 }, picks: [1], cursor: 40 },
  { name: 'clamps a reopened pick below the first slot', progress: { anchor: { kind: 'reopen', pickNumber: 0 }, historyLength: 0 }, picks: [], cursor: 1 },
  { name: 'imports the saved cursor independently of history gaps', progress: { anchor: { kind: 'carry', pickNumber: 96 }, historyLength: 1 }, picks: [1], cursor: 96 },
  { name: 'honors provider progress below its accepted history', progress: { anchor: { kind: 'provider', nextPickNumber: 4, keeperSlots: [], totalPicks: 140 }, historyLength: 1 }, picks: [20], cursor: 4 },
  { name: 'advances only appends after the provider anchor', progress: { anchor: { kind: 'provider', nextPickNumber: 4, keeperSlots: [], totalPicks: 140 }, historyLength: 1 }, picks: [20, 4], cursor: 5 },
  { name: 'skips contiguous accepted provider keeper slots', progress: { anchor: { kind: 'provider', nextPickNumber: 1, keeperSlots: [1, 2], totalPicks: 140 }, historyLength: 0 }, picks: [], cursor: 3 },
  { name: 'bounds provider progress at completion', progress: { anchor: { kind: 'provider', nextPickNumber: 999, keeperSlots: [], totalPicks: 140 }, historyLength: 0 }, picks: [], cursor: 141 },
  { name: 'rounds and bounds provider progress at the beginning', progress: { anchor: { kind: 'provider', nextPickNumber: -2.2, keeperSlots: [], totalPicks: 140 }, historyLength: 0 }, picks: [], cursor: 1 },
  { name: 'skips newly accepted live keeper supply from its prior cursor', progress: { anchor: { kind: 'past-keepers', fromPick: 70, keeperSlots: [1, 70, 71], totalPicks: 140 }, historyLength: 1 }, picks: [2], cursor: 72 },
  { name: 'finds the first gap after a provisional rebuild', progress: { anchor: { kind: 'first-open', keeperSlots: [1, 70, 140], totalPicks: 140 }, historyLength: 2 }, picks: [3, 2], cursor: 4 },
  { name: 'leaves an earlier provisional gap open', progress: { anchor: { kind: 'first-open', keeperSlots: [], totalPicks: 140 }, historyLength: 2 }, picks: [2, 3], cursor: 1 },
  { name: 'marks all reserved slots complete', progress: { anchor: { kind: 'first-open', keeperSlots: [1, 2], totalPicks: 2 }, historyLength: 0 }, picks: [], cursor: 3 },
];

describe('accepted draft progress', () => {
  it.each(cases)('$name', ({ progress, picks, cursor }) => {
    const history = picks.map(pickNumber => ({ pickNumber, playerId: `player-${pickNumber}`, position: 'WR' as const, teamIndex: 0 }));
    const before = structuredClone({ history, progress });
    expect(deriveDraftCursor(history, progress)).toBe(cursor);
    expect({ history, progress }).toEqual(before);
  });
});
