import { describe, expect, it } from 'vitest';
import {
  isBoundedInteger,
  isDraftSize,
  MAX_DRAFT_PICKS,
  MAX_DRAFT_ROUNDS,
  MAX_DRAFT_TEAMS,
} from './index.js';

describe('resource limits', () => {
  it('derives the pick ceiling from the team and round ceilings', () => {
    expect(MAX_DRAFT_PICKS).toBe(MAX_DRAFT_TEAMS * MAX_DRAFT_ROUNDS);
  });

  it('accepts integers at both inclusive bounds', () => {
    expect(isBoundedInteger(1, 1, 10)).toBe(true);
    expect(isBoundedInteger(10, 1, 10)).toBe(true);
  });

  it.each([
    ['below the minimum', 0],
    ['above the maximum', 11],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ['a numeric string', '5'],
    ['null', null],
  ])('rejects values that are %s', (_label, value) => {
    expect(isBoundedInteger(value, 1, 10)).toBe(false);
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
