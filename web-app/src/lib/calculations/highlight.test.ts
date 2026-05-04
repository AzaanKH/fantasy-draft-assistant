import { describe, it, expect } from 'vitest';
import { determineHighlightLevel } from './highlight';
import type { TeamEnvironment } from '@fantasy-draft/shared';

// Helper to create a team environment with specific offense score
function createTeamEnv(offenseScore: number): TeamEnvironment {
  return {
    team: 'DET',
    name: 'Detroit Lions',
    offenseScore,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 1,
    passAttemptsRank: 5,
    rushAttemptsRank: 12,
    coachingStability: true,
  };
}

describe('determineHighlightLevel', () => {
  describe('avoid level', () => {
    it('returns avoid when value is -15 or less', () => {
      expect(determineHighlightLevel(-15, false, undefined)).toBe('avoid');
      expect(determineHighlightLevel(-20, false, undefined)).toBe('avoid');
      expect(determineHighlightLevel(-30, true, createTeamEnv(10))).toBe('avoid');
    });
  });

  describe('strong-buy level', () => {
    it('returns strong-buy when value >= 10 AND contract year', () => {
      const result = determineHighlightLevel(10, true, createTeamEnv(5));
      expect(result).toBe('strong-buy');
    });

    it('returns strong-buy when value >= 10 AND top offense (score >= 8)', () => {
      const result = determineHighlightLevel(12, false, createTeamEnv(8));
      expect(result).toBe('strong-buy');
    });

    it('returns strong-buy when value >= 10 with both contract year and top offense', () => {
      const result = determineHighlightLevel(15, true, createTeamEnv(9));
      expect(result).toBe('strong-buy');
    });

    it('does not return strong-buy when value >= 10 but no contract year and not top offense', () => {
      const result = determineHighlightLevel(10, false, createTeamEnv(7));
      expect(result).not.toBe('strong-buy');
    });
  });

  describe('good-value level', () => {
    it('returns good-value when value >= 5', () => {
      expect(determineHighlightLevel(5, false, undefined)).toBe('good-value');
      expect(determineHighlightLevel(7, false, createTeamEnv(4))).toBe('good-value');
      expect(determineHighlightLevel(9, false, createTeamEnv(5))).toBe('good-value');
    });

    it('returns good-value when contract year with decent offense (score >= 6)', () => {
      const result = determineHighlightLevel(3, true, createTeamEnv(6));
      expect(result).toBe('good-value');
    });

    it('returns good-value when contract year with good offense', () => {
      const result = determineHighlightLevel(0, true, createTeamEnv(7));
      expect(result).toBe('good-value');
    });
  });

  describe('neutral level', () => {
    it('returns neutral for average value with no special factors', () => {
      expect(determineHighlightLevel(0, false, undefined)).toBe('neutral');
      expect(determineHighlightLevel(2, false, createTeamEnv(5))).toBe('neutral');
      expect(determineHighlightLevel(4, false, createTeamEnv(7))).toBe('neutral');
    });

    it('returns neutral for contract year with poor offense', () => {
      const result = determineHighlightLevel(0, true, createTeamEnv(5));
      expect(result).toBe('neutral');
    });

    it('returns neutral for slight negative value', () => {
      expect(determineHighlightLevel(-5, false, undefined)).toBe('neutral');
      expect(determineHighlightLevel(-14, false, createTeamEnv(8))).toBe('neutral');
    });
  });

  describe('edge cases', () => {
    it('handles undefined team environment', () => {
      expect(determineHighlightLevel(10, true, undefined)).toBe('strong-buy');
      expect(determineHighlightLevel(5, false, undefined)).toBe('good-value');
      expect(determineHighlightLevel(0, false, undefined)).toBe('neutral');
    });

    it('handles boundary values correctly', () => {
      // Exactly at thresholds
      expect(determineHighlightLevel(-15, false, undefined)).toBe('avoid');
      expect(determineHighlightLevel(-14, false, undefined)).toBe('neutral');
      expect(determineHighlightLevel(5, false, undefined)).toBe('good-value');
      expect(determineHighlightLevel(4, false, undefined)).toBe('neutral');
      expect(determineHighlightLevel(10, true, undefined)).toBe('strong-buy');
      expect(determineHighlightLevel(9, true, undefined)).toBe('good-value');
    });
  });
});
