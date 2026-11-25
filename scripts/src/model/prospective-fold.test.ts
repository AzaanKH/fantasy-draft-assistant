import { describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  fullSeasonPace,
  isRegularSeasonComplete,
  prospectiveDerivedStatements,
  prospectiveOutcomeStatements,
} from './prospective-fold.js';

const status = (regGamesPlayed: number, regGamesScheduled = 272, regGamesWithStats = regGamesPlayed) => ({
  season: 2026,
  regGamesScheduled,
  regGamesPlayed,
  regGamesWithStats,
  lastWeekPlayed: 11,
  fetchedAt: '2026-11-24T00:00:00Z',
});

describe('prospective fold', () => {
  it('counts a season only once all 272 regular-season games are scored and matched to player stats', () => {
    expect(isRegularSeasonComplete(status(163))).toBe(false);
    expect(isRegularSeasonComplete(status(272))).toBe(true);
    expect(isRegularSeasonComplete(status(0, 0))).toBe(false);
    // A partial schedule download whose every game is scored is still incomplete.
    expect(isRegularSeasonComplete(status(163, 163))).toBe(false);
    // Scores can land before the weekly stats.
    expect(isRegularSeasonComplete(status(272, 272, 256))).toBe(false);
  });

  it('counts player stats and team pace only from scored games with matching player stats', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      for (const sql of [
        'create schema source',
        'create schema model',
        `create table source.nflverse_schedules_prospective as select * from (values
          (2026, 'g1', 1, 'DET', 'GB', 7),
          (2026, 'g2', 2, 'DET', 'CHI', 3),
          (2026, 'g3', 3, 'DET', 'MIN', null)
        ) as t(season, game_id, week, home_team, away_team, result)`,
        // Week 2 is scored but its player stats have not arrived.
        `create table source.nflverse_player_week_prospective as select * from (values
          (2026, 'p1', 'g1', 1, 'DET', 20.0, 10, 2)
        ) as t(season, player_id, game_id, week, team, fantasy_points_ppr, carries, receptions)`,
        ...prospectiveDerivedStatements(),
      ]) await connection.run(sql);
      const status = (await connection.runAndReadAll('select * from model.prospective_season_status'))
        .getRowObjectsJson()[0];
      expect(status).toMatchObject({ reg_games_scheduled: 3, reg_games_played: 2, reg_games_with_stats: 1 });
      const outcome = (await connection.runAndReadAll('select * from model.prospective_player_outcomes'))
        .getRowObjectsJson()[0];
      expect(outcome).toMatchObject({ games: 1, ppr_points: 20, team_games_played: 1, team_games_scheduled: 3 });
    } finally {
      connection.closeSync();
    }
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
