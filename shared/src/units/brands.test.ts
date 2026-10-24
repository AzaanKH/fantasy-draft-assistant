import { describe, expect, it } from 'vitest';
import { asPercent, asProbability, asRank, asVor, type Percent, type Probability, type Rank, type Vor } from './brands.js';

function takesProbability(value: Probability): number { return value; }
function takesPercent(value: Percent): number { return value; }
function takesRank(value: Rank): number { return value; }
function takesVor(value: Vor): number { return value; }

describe('numeric unit brands', () => {
  it('are plain numbers at runtime and read as numbers', () => {
    const chance = asProbability(0.42);
    const sum: number = chance + asPercent(10);
    expect(chance).toBe(0.42);
    expect(sum).toBeCloseTo(10.42);
    expect(JSON.stringify({ rank: asRank(3), vor: asVor(-1.5) })).toBe('{"rank":3,"vor":-1.5}');
  });

  it('reject mixing units at compile time', () => {
    const chance = asProbability(0.42);
    const share = asPercent(42);
    const rank = asRank(7);
    const vor = asVor(12);
    // @ts-expect-error A percent is not a probability.
    takesProbability(share);
    // @ts-expect-error A probability is not a percent.
    takesPercent(chance);
    // @ts-expect-error VOR is not a rank.
    takesRank(vor);
    // @ts-expect-error A rank is not VOR.
    takesVor(rank);
    // @ts-expect-error An unbranded number needs a constructor.
    takesProbability(0.42);
    // @ts-expect-error Arithmetic yields a plain number until it is branded again.
    takesPercent(chance * 100);
    expect([takesProbability(chance), takesPercent(share), takesRank(rank), takesVor(vor)]).toEqual([0.42, 42, 7, 12]);
  });
});
