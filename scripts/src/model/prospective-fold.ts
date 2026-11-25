/**
 * Prospective folds: seasons drafted after the `2026-predeclared-v1` model declaration was frozen. Their outcomes
 * were unknown when the model, ECR and Best Pick made their picks, so they are the only out-of-sample evidence that
 * cannot have shaped the declaration. A fold scores season-to-date until every regular-season game has a result.
 */

/** The declaration was frozen before this season's draft, so this and later seasons are prospective. */
export const PROSPECTIVE_FIRST_SEASON = 2026;

const NFLVERSE_RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';
const SCHEDULES_URL = `${NFLVERSE_RELEASES}/schedules/games.parquet`;

function playerWeekUrl(season: number): string {
  return `${NFLVERSE_RELEASES}/stats_player/stats_player_week_${String(season)}.parquet`;
}

/**
 * Loads nflverse regular-season weekly player stats and the schedule for the prospective seasons, then materializes
 * season-to-date player outcomes with each player's team games played and scheduled, and one status row per season.
 */
export function prospectiveOutcomeStatements(seasons: readonly number[]): string[] {
  if (seasons.length === 0) return [];
  const seasonList = seasons.map(String).join(', ');
  const weekUrls = seasons.map((season) => `'${playerWeekUrl(season)}'`).join(', ');
  return [
    `create schema if not exists source`,
    `create schema if not exists model`,
    `create or replace table source.nflverse_player_week_prospective as
      select *
      from read_parquet([${weekUrls}], union_by_name = true)
      where season_type = 'REG' and season in (${seasonList})`,
    `create or replace table source.nflverse_schedules_prospective as
      select *
      from read_parquet('${SCHEDULES_URL}')
      where game_type = 'REG' and season in (${seasonList})`,
    ...prospectiveDerivedStatements(),
  ];
}

/** Derives match status, team games and player outcomes from the loaded prospective schedule and weekly stats. */
export function prospectiveDerivedStatements(): string[] {
  return [
    // A scored game counts only once its weekly player stats have arrived: schedule results can land first.
    `create or replace table model.prospective_matched_games as
      select distinct
        schedules.season::integer as season,
        schedules.game_id::varchar as game_id,
        schedules.week::integer as week,
        schedules.home_team::varchar as home_team,
        schedules.away_team::varchar as away_team
      from source.nflverse_schedules_prospective schedules
      join source.nflverse_player_week_prospective weeks on weeks.game_id = schedules.game_id
      where schedules.result is not null`,
    `create or replace table model.prospective_season_status as
      select
        schedules.season::integer as season,
        count(distinct schedules.game_id)::integer as reg_games_scheduled,
        count(distinct case when schedules.result is not null then schedules.game_id end)::integer
          as reg_games_played,
        count(distinct matched.game_id)::integer as reg_games_with_stats,
        max(matched.week)::integer as last_week_played,
        strftime(current_timestamp, '%Y-%m-%dT%H:%M:%SZ') as fetched_at
      from source.nflverse_schedules_prospective schedules
      left join model.prospective_matched_games matched on matched.game_id = schedules.game_id
      group by 1`,
    `create or replace table model.prospective_team_games as
      with scheduled as (
        select season, game_id, home_team as team from source.nflverse_schedules_prospective
        union
        select season, game_id, away_team as team from source.nflverse_schedules_prospective
      ), matched as (
        select game_id, home_team as team from model.prospective_matched_games
        union
        select game_id, away_team as team from model.prospective_matched_games
      )
      select scheduled.season::integer as season, scheduled.team::varchar as team,
        count(distinct scheduled.game_id)::integer as scheduled,
        count(distinct matched.game_id)::integer as played
      from scheduled
      left join matched on matched.game_id = scheduled.game_id and matched.team = scheduled.team
      group by 1, 2`,
    `create or replace table model.prospective_player_outcomes as
      with players as (
        select
          weeks.season::integer as season,
          weeks.player_id::varchar as gsis_id,
          arg_max(weeks.team, weeks.week)::varchar as team,
          count(distinct weeks.game_id)::double as games,
          sum(coalesce(weeks.fantasy_points_ppr, 0))::double as ppr_points,
          sum(coalesce(weeks.carries, 0))::double as rush_attempts,
          sum(coalesce(weeks.receptions, 0))::double as receptions
        from source.nflverse_player_week_prospective weeks
        join model.prospective_matched_games matched on matched.game_id = weeks.game_id
        where weeks.player_id is not null
        group by 1, 2
      )
      select players.*, teams.played as team_games_played, teams.scheduled as team_games_scheduled
      from players
      left join model.prospective_team_games teams
        on teams.season = players.season and teams.team = players.team`,
  ];
}

/** Regular-season games in a 32-team, 17-game NFL season. */
export const REGULAR_SEASON_GAMES = 272;

export interface ProspectiveSeasonStatus {
  readonly season: number;
  readonly regGamesScheduled: number;
  readonly regGamesPlayed: number;
  /** Scored games whose weekly player stats have arrived; only these count toward outcomes and pace. */
  readonly regGamesWithStats: number;
  readonly lastWeekPlayed: number | null;
  readonly fetchedAt: string;
}

/**
 * A season counts toward the release gate only when all 272 regular-season games are on the schedule, scored, and
 * matched to weekly player stats; a partial schedule download can never look complete.
 */
export function isRegularSeasonComplete(status: ProspectiveSeasonStatus): boolean {
  return status.regGamesScheduled === REGULAR_SEASON_GAMES &&
    status.regGamesPlayed === REGULAR_SEASON_GAMES &&
    status.regGamesWithStats === REGULAR_SEASON_GAMES;
}

/**
 * Season-to-date totals scaled to a full-season pace by the player's team games: a player who misses games keeps
 * the zeros, so injuries still count. Complete seasons, and players with no team schedule, are left unscaled.
 */
export function fullSeasonPace(
  total: number,
  teamGamesPlayed: number | null,
  teamGamesScheduled: number | null
): number {
  if (teamGamesPlayed === null || teamGamesScheduled === null || teamGamesPlayed <= 0) return total;
  return total * Math.max(1, teamGamesScheduled / teamGamesPlayed);
}
