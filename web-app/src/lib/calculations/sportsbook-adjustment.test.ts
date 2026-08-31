import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_RULES,
  americanOddsToImpliedProbability,
  calculateSportsbookProjectionAdjustment,
  normalizeSportsbookPlayerName,
  type SportsbookOverUnderLine,
} from '@fantasy-draft/shared';

describe('sportsbook projection adjustment', () => {
  it('converts positive and negative American odds to raw implied probability', () => {
    expect(americanOddsToImpliedProbability(120)).toBeCloseTo(0.4545, 4);
    expect(americanOddsToImpliedProbability(-150)).toBeCloseTo(0.6, 4);
  });

  it('normalizes suffixes, punctuation, and known name variants', () => {
    expect(normalizeSportsbookPlayerName('Kenneth Walker III')).toBe(
      normalizeSportsbookPlayerName('Kenneth Walker')
    );
    expect(normalizeSportsbookPlayerName('Cam Ward')).toBe(
      normalizeSportsbookPlayerName('Cameron Ward')
    );
  });

  it('weights a two-book consensus stat delta by confidence and scoring value', () => {
    const lines: SportsbookOverUnderLine[] = [
      {
        sportsbook: 'fanduel',
        playerName: 'Example Receiver',
        market: 'receivingYards',
        line: 950.5,
        overOdds: -114,
        underOdds: -114,
        sourceFile: 'fanduel.pdf',
      },
      {
        sportsbook: 'draftkings',
        playerName: 'Example Receiver',
        market: 'receivingYards',
        line: 949.5,
        overOdds: -110,
        underOdds: -110,
        sourceFile: 'draftkings.pdf',
      },
    ];

    const result = calculateSportsbookProjectionAdjustment({
      playerName: 'Example Receiver',
      position: 'WR',
      existingProjection: 200,
      fantasyProsStats: { receivingYards: 900 },
      overUnderLines: lines,
      scoringRules: DEFAULT_SCORING_RULES,
    });

    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]?.consensusStat).toBe(950);
    expect(result.markets[0]?.confidence).toBeCloseTo(0.646, 3);
    expect(result.marketAdjustment).toBeCloseTo(3.23, 2);
    expect(result.adjustedProjection).toBeCloseTo(203.23, 2);
  });

  it('uses full PPR plus the tight-end premium for reception differences', () => {
    const result = calculateSportsbookProjectionAdjustment({
      playerName: 'Example Tight End',
      position: 'TE',
      existingProjection: 180,
      fantasyProsStats: { receptions: 60 },
      overUnderLines: [{
        sportsbook: 'draftkings',
        playerName: 'Example Tight End',
        market: 'receptions',
        line: 65,
        overOdds: -115,
        underOdds: -110,
        sourceFile: 'draftkings.pdf',
      }],
      scoringRules: DEFAULT_SCORING_RULES,
    });

    expect(result.markets[0]?.leagueScoringValue).toBe(1.5);
    expect(result.marketAdjustment).toBeGreaterThan(2.9);
    expect(result.marketAdjustment).toBeLessThan(3);
  });
});
