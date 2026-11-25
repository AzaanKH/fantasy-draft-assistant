import { describe, expect, it } from 'vitest';
import { fullSeasonPace, isRegularSeasonComplete, prospectiveOutcomeStatements } from './prospective-fold.js';

const status = (regGamesPlayed: number, regGamesScheduled = 272) => ({
  season: 2026,
  regGamesScheduled,
  regGamesPlayed,
  lastWeekPlayed: 11,
  fetchedAt: '2026-11-24T00:00:00Z',
});

describe('prospective fold', () => {
  it('counts a season only once every scheduled regular-season game has a result', () => {
    expect(isRegularSeasonComplete(status(163))).toBe(false);
    expect(isRegularSeasonComplete(status(272))).toBe(true);
    expect(isRegularSeasonComplete(status(0, 0))).toBe(false);
  });

  it('scales season-to-date totals by team games, keeping missed games as zeros', () => {
    // Ten team games of seventeen: a player who scored 100 is on a 170-point pace, whether or not he played all ten.
    expect(fullSeasonPace(100, 10, 17)).toBe(170);
    expect(fullSeasonPace(100, 17, 17)).toBe(100);
    expect(fullSeasonPace(100, null, null)).toBe(100);
    expect(fullSeasonPace(0, 10, 17)).toBe(0);
  });

  it('reads only regular-season weeks for the requested seasons', () => {
    const sql = prospectiveOutcomeStatements([2026]).join('\n');
    expect(sql).toContain('stats_player_week_2026.parquet');
    expect(sql).toContain(`season_type = 'REG' and season in (2026)`);
    expect(sql).toContain(`game_type = 'REG' and season in (2026)`);
    expect(prospectiveOutcomeStatements([])).toEqual([]);
  });
});
