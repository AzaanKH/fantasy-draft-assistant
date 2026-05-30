import { describe, expect, it } from 'vitest';
import {
  calculateLeagueScoringAdjustment,
  getHistoricalLeagueScoringAdjustments,
} from './league-scoring.js';

describe('league scoring adjustments', () => {
  it('adds rush-attempt bonuses for the current league rules', () => {
    expect(calculateLeagueScoringAdjustment({
      position: 'RB',
      rushAttempts: 200,
      receptions: 50,
    })).toBe(40);
  });

  it('adds TE reception premium only for tight ends', () => {
    expect(calculateLeagueScoringAdjustment({
      position: 'TE',
      rushAttempts: 0,
      receptions: 80,
    })).toBe(40);
    expect(calculateLeagueScoringAdjustment({
      position: 'WR',
      rushAttempts: 0,
      receptions: 80,
    })).toBe(0);
  });

  it('keeps historical season rules separate', () => {
    expect(getHistoricalLeagueScoringAdjustments(2023)).toEqual({
      rushAttemptBonus: 0,
      teReceptionBonus: 0,
    });
    expect(getHistoricalLeagueScoringAdjustments(2024)).toEqual({
      rushAttemptBonus: 0.2,
      teReceptionBonus: 0,
    });
    expect(getHistoricalLeagueScoringAdjustments(2025)).toEqual({
      rushAttemptBonus: 0.2,
      teReceptionBonus: 0.5,
    });
  });
});
