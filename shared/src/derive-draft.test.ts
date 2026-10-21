import { DEFAULT_ROSTER_REQUIREMENTS } from './draft.js';
import { describe, expect, it } from 'vitest';
import { deriveDraft, type DraftSource } from './derive-draft.js';
import { createSlotSequence, type DraftFormat } from './draft-order.js';

const format: DraftFormat = { type: 'snake', teams: 10, rounds: 14 };
const source: DraftSource = {
  progress: { anchor: { kind: 'start' }, historyLength: 0 },
  sessionMode: 'live', rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
  history: [], keepers: [], myTeamIndex: 0, shortlistOrder: [],
};

describe('shadow draft derivation', () => {
  it.each(['snake', 'linear', 'auction'] as const)('reserves keeper costs and finds the first gap using %s slots', type => {
    const config = { ...format, type };
    const order = createSlotSequence(config);
    const keepers = [1, 70, 140].map(pick => ({
      playerId: `keeper-${pick}`, position: 'RB' as const,
      teamIndex: order.at(pick).teamIndex, round: order.at(pick).round,
    }));
    const input = {
      ...source, keepers,
      progress: { anchor: { kind: 'first-open' as const, keeperSlots: [1, 70, 140], totalPicks: 140 }, historyLength: 2 },
      history: [
        { pickNumber: 3, playerId: 'provisional', position: 'WR' as const, teamIndex: 2 },
        { pickNumber: 2, playerId: 'confirmed', position: 'TE' as const, teamIndex: 1 },
      ],
      shortlistOrder: ['later', 'keeper-70', 'provisional', 'another'],
    };
    const before = structuredClone(input);
    const view = deriveDraft(input, config);
    expect(view.currentPick).toBe(4);
    expect(view.draftedPlayerIds).toEqual(new Set(['keeper-1', 'keeper-70', 'keeper-140', 'provisional', 'confirmed']));
    expect(view.shortlistedPlayerIds).toEqual(['later', 'another']);
    expect(view.teamRosters[order.at(140).teamIndex]?.RB).toContain('keeper-140');
    expect(view.myRoster.RB).toContain('keeper-1');
    expect(view.isMyTurn).toBe(false);
    expect(input).toEqual(before);
    expect(deriveDraft(input, config)).toEqual(view);
  });

  it('lets completed history displace a keeper by slot or by player, without inventing a team', () => {
    const view = deriveDraft({
      ...source,
      progress: { anchor: { kind: 'first-open', keeperSlots: [], totalPicks: 140 }, historyLength: 2 },
      keepers: [
        { playerId: 'moved', position: 'RB', teamIndex: 0, round: 1 },
        { playerId: 'displaced', position: 'TE', teamIndex: 1, round: 1 },
      ],
      history: [
        { pickNumber: 2, playerId: 'replacement', position: 'WR', teamIndex: 1 },
        { pickNumber: 3, playerId: 'moved', position: 'RB', teamIndex: 2 },
      ],
    }, format);
    expect(view.currentPick).toBe(1);
    expect(view.isMyTurn).toBe(true);
    expect(view.myRoster.RB).toEqual([]);
    expect(view.teamRosters[2]?.RB).toEqual(['moved']);
    expect(view.draftedPlayerIds).toEqual(new Set(['replacement', 'moved']));
  });

  it('deduplicates a consumed keeper and preserves shortlist intent through removal and correction', () => {
    const keeper = { playerId: 'keeper', position: 'RB' as const, teamIndex: 0, round: 1 };
    const input = {
      ...source, keepers: [keeper], shortlistOrder: ['a', 'b', 'c'],
      history: [
        { ...keeper, pickNumber: 1 },
        { pickNumber: 2, playerId: 'b', position: 'WR' as const, teamIndex: 1 },
      ],
    };
    expect(deriveDraft(input, format).myRoster.RB).toEqual(['keeper']);
    expect(deriveDraft(input, format).shortlistedPlayerIds).toEqual(['a', 'c']);
    expect(deriveDraft({ ...input, history: input.history.slice(0, 1) }, format).shortlistedPlayerIds).toEqual(['a', 'b', 'c']);
    const corrected = { ...input, history: [{ pickNumber: 2, playerId: 'a', position: 'TE' as const, teamIndex: 1 }] };
    expect(deriveDraft(corrected, format).shortlistedPlayerIds).toEqual(['b', 'c']);
    expect(input.shortlistOrder).toEqual(['a', 'b', 'c']);
  });

  it('marks a full 140-slot draft complete', () => {
    const order = createSlotSequence(format);
    const view = deriveDraft({
      ...source,
      history: order.slots.map(slot => ({
        pickNumber: slot.pick, playerId: `player-${slot.pick}`, position: 'WR', teamIndex: slot.teamIndex,
      })),
    }, format);
    expect(view.currentPick).toBe(141);
    expect(view.isMyTurn).toBe(false);
    expect(view.draftedPlayerIds.size).toBe(140);
    expect(view.teamRosters.every(roster => roster.WR.length === 14)).toBe(true);
  });
});

it('does not let a repeated keeper entry hide an earlier conflicting selection', () => {
  const view = deriveDraft({
    ...source,
    keepers: [{ playerId: 'keeper', position: 'RB', teamIndex: 0, round: 1 }],
    history: [
      { pickNumber: 1, playerId: 'replacement', position: 'WR', teamIndex: 0 },
      { pickNumber: 1, playerId: 'keeper', position: 'RB', teamIndex: 1 },
    ],
  }, format);
  expect(view.myRoster.RB).toEqual([]);
  expect(view.myRoster.WR).toEqual(['replacement']);
  expect(view.teamRosters[1]?.RB).toEqual(['keeper']);
});
