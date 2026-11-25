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

  it('counts team games across a traded player\'s stints, each with its own bye week', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      // Played through week 4 of 6. GB's bye is week 5, DET's week 2. p1 plays weeks 1-2 for GB, then 3-4 for DET.
      for (const sql of [
        'create schema source',
        'create schema model',
        `create table source.nflverse_schedules_prospective as select * from (values
          (2026, 'gb1', 1, 'GB', 'O1', 3), (2026, 'gb2', 2, 'GB', 'O2', 3), (2026, 'gb3', 3, 'GB', 'O3', 3),
          (2026, 'gb4', 4, 'GB', 'O4', 3), (2026, 'gb6', 6, 'GB', 'O6', null),
          (2026, 'det1', 1, 'DET', 'P1', 7), (2026, 'det3', 3, 'DET', 'P3', 7), (2026, 'det4', 4, 'DET', 'P4', 7),
          (2026, 'det5', 5, 'DET', 'P5', null), (2026, 'det6', 6, 'DET', 'P6', null)
        ) as t(season, game_id, week, home_team, away_team, result)`,
        `create table source.nflverse_player_week_prospective as select * from (values
          (2026, 'p1', 'gb1', 1, 'GB', 10.0, 0, 5), (2026, 'p1', 'gb2', 2, 'GB', 10.0, 0, 5),
          (2026, 'p1', 'det3', 3, 'DET', 10.0, 0, 5), (2026, 'p1', 'det4', 4, 'DET', 10.0, 0, 5),
          (2026, 'p2', 'gb3', 3, 'GB', 1.0, 0, 0), (2026, 'p2', 'gb4', 4, 'GB', 1.0, 0, 0),
          (2026, 'p3', 'det1', 1, 'DET', 1.0, 0, 0)
        ) as t(season, player_id, game_id, week, team, fantasy_points_ppr, carries, receptions)`,
        ...prospectiveDerivedStatements(),
      ]) await connection.run(sql);
      const outcomes = (await connection.runAndReadAll(
        'select * from model.prospective_player_outcomes order by gsis_id'
      )).getRowObjectsJson();
      // GB weeks 1-2 (2 of 2 played) plus DET weeks 3-6 (2 of 4 played). The latest team alone (DET) would have
      // given 3 played of 5, fewer team games than the player's own 4.
      expect(outcomes[0]).toMatchObject({
        gsis_id: 'p1', team: 'DET', games: 4, ppr_points: 40, team_games_played: 4, team_games_scheduled: 6,
      });
      // A player who stays put counts his team's whole schedule, including games he missed.
      expect(outcomes[2]).toMatchObject({ gsis_id: 'p3', games: 1, team_games_played: 3, team_games_scheduled: 5 });
    } finally {
      connection.closeSync();
    }
  });

  it('scales season-to-date totals to a 17-game pace by team games, keeping missed games as zeros', () => {
    // Ten team games: a player who scored 100 is on a 170-point pace, whether or not he played all ten.
    expect(fullSeasonPace(100, 10)).toBe(170);
    expect(fullSeasonPace(100, 17)).toBe(100);
    expect(fullSeasonPace(100, null)).toBe(100);
    expect(fullSeasonPace(0, 10)).toBe(0);
    // A traded player whose stints scheduled 18 games still paces to 17: 100.3 over 11 played is 155.01, not 164.13.
    expect(fullSeasonPace(100.3, 11)).toBeCloseTo(155.01, 2);
    // Eighteen matched team games while another game's stats are still missing: 180 paces down to 170.
    expect(fullSeasonPace(180, 18)).toBe(170);
  });

  it('reads only regular-season weeks for the requested seasons', () => {
    const sql = prospectiveOutcomeStatements([2026]).join('\n');
    expect(sql).toContain('stats_player_week_2026.parquet');
    expect(sql).toContain(`season_type = 'REG' and season in (2026)`);
    expect(sql).toContain(`game_type = 'REG' and season in (2026)`);
    expect(prospectiveOutcomeStatements([])).toEqual([]);
  });
});
