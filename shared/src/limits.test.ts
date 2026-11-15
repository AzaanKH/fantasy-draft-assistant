import { describe, expect, it } from 'vitest';
import {
  isBoundedInteger,
  isDraftSize,
  MAX_DRAFT_ROUNDS,
  MAX_DRAFT_TEAMS,
} from './limits.js';

describe('resource limits', () => {
  it('accepts integers at both inclusive bounds', () => {
    expect(isBoundedInteger(1, 1, 10)).toBe(true);
    expect(isBoundedInteger(10, 1, 10)).toBe(true);
  });

  it.each([
    ['below the minimum', 0, 1, 10],
    ['above the maximum', 11, 1, 10],
    ['fractional', 1.5, 1, 10],
    ['NaN', Number.NaN, 1, 10],
    ['infinite', Number.POSITIVE_INFINITY, 1, 10],
    ['unsafe, even within the bounds', Number.MAX_SAFE_INTEGER + 1, 0, Number.MAX_VALUE],
    ['a numeric string', '5', 1, 10],
    ['null', null, 1, 10],
  ])('rejects values that are %s', (_label, value, minimum, maximum) => {
    expect(isBoundedInteger(value, minimum, maximum)).toBe(false);
  });

  it('bounds draft sizes before client state is allocated', () => {
    expect(isDraftSize(2, 1)).toBe(true);
    expect(isDraftSize(MAX_DRAFT_TEAMS, MAX_DRAFT_ROUNDS)).toBe(true);
    expect(isDraftSize(1, 14)).toBe(false);
    expect(isDraftSize(MAX_DRAFT_TEAMS + 1, 14)).toBe(false);
    expect(isDraftSize(10, 0)).toBe(false);
    expect(isDraftSize(10, MAX_DRAFT_ROUNDS + 1)).toBe(false);
    expect(isDraftSize('10', 14)).toBe(false);
  });
});

