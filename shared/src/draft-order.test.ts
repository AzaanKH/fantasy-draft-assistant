import { describe, expect, it } from 'vitest';
import { createSlotSequence } from './draft-order.js';

const formats = ['snake', 'linear', 'auction'] as const;

describe('draft slot sequence', () => {
  it.each(formats)('maps and inverts every %s slot for supported league sizes', type => {
    for (const teams of [2, 3, 10, 12, 16]) {
      const order = createSlotSequence({ type, teams, rounds: 15 });
      expect(order.slots).toHaveLength(teams * 15);
      for (const slot of order.slots) {
        const position = (slot.pick - 1) % teams;
        const reverse = type !== 'linear' && slot.round % 2 === 0;
        expect(slot.teamIndex).toBe(reverse ? teams - position - 1 : position);
        expect(order.at(slot.pick)).toBe(slot);
        expect(order.forTeamRound(slot.teamIndex, slot.round)).toBe(slot);
        expect(slot.label).toBe(`${slot.round}.${String(position + 1).padStart(2, '0')}`);
        expect(slot.direction).toBe(reverse ? 'reverse' : 'forward');
        expect(slot.endsRound).toBe(position === teams - 1);
        expect(slot.kind).toBe(type === 'auction' ? 'legacy-auction-nomination' : 'ordered-allocation');
      }
    }
  });

  it('keeps linear turn order at the even-round boundary and after reserved picks', () => {
    const order = createSlotSequence({ type: 'linear', teams: 4, rounds: 3 });
    expect(order.at(5).teamIndex).toBe(0);
    expect(order.forTeamRound(1, 2).pick).toBe(6);
    expect(order.picksUntilTurn(1, 5)).toBe(1);
    expect(order.picksUntilTurn(1, 6)).toBe(0);
    expect(order.nextForTeam(1, 5, new Set([6]))?.pick).toBe(10);
    expect(order.nextForTeam(1, 11)).toBeNull();
    expect(order.picksUntilTurn(1, 13)).toBeNull();
  });

  it('retains consecutive snake turns, nominal auction order, and distinct order identities', () => {
    const snake = createSlotSequence({ type: 'snake', teams: 4, rounds: 3 });
    const auction = createSlotSequence({ type: 'auction', teams: 4, rounds: 3 });
    expect(snake.nextForTeam(3, 4)?.pick).toBe(4);
    expect(snake.nextForTeam(3, 5)?.pick).toBe(5);
    expect(auction.slots.map(slot => slot.teamIndex)).toEqual(snake.slots.map(slot => slot.teamIndex));
    expect(auction.id).not.toBe(snake.id);
    expect(createSlotSequence({ type: 'linear', teams: 4, rounds: 3 }).id).not.toBe(snake.id);
    expect(createSlotSequence({ type: 'snake', teams: 4, rounds: 4 }).id).not.toBe(snake.id);
  });

  it('rejects invalid dimensions and slot references', () => {
    for (const teams of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => createSlotSequence({ type: 'linear', teams, rounds: 2 })).toThrow(RangeError);
    }
    const order = createSlotSequence({ type: 'snake', teams: 4, rounds: 2 });
    for (const pick of [0, -1, 9, 1.5, NaN]) expect(() => order.at(pick)).toThrow(RangeError);
    expect(() => order.forTeamRound(4, 1)).toThrow(RangeError);
    expect(() => order.forTeamRound(0, 3)).toThrow(RangeError);
  });
});


it('reuses immutable sequences and labels draft completion without allocating a slot', () => {
  const format = { type: 'linear', teams: 4, rounds: 3 } as const;
  const order = createSlotSequence(format);
  expect(createSlotSequence(format)).toBe(order);
  expect(Object.isFrozen(order)).toBe(true);
  expect(Object.isFrozen(order.slots)).toBe(true);
  expect(Object.isFrozen(order.at(1))).toBe(true);
  expect(order.label(13)).toBe('4.01');
  expect(() => order.at(13)).toThrow(RangeError);
  expect(() => order.label(0)).toThrow(RangeError);
});
