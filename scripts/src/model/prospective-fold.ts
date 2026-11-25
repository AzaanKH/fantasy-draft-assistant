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
    `create or replace table model.prospective_season_status as
      select
        season::integer as season,
        count(*)::integer as reg_games_scheduled,
        count(result)::integer as reg_games_played,
        max(case when result is not null then week end)::integer as last_week_played,
        strftime(current_timestamp, '%Y-%m-%dT%H:%M:%SZ') as fetched_at
      from source.nflverse_schedules_prospective
      group by 1`,
    `create or replace table model.prospective_team_games as
      with sides as (
        select season, home_team as team, result from source.nflverse_schedules_prospective
        union all
        select season, away_team as team, result from source.nflverse_schedules_prospective
      )
      select season::integer as season, team::varchar as team,
        count(*)::integer as scheduled, count(result)::integer as played
      from sides
      group by 1, 2`,
    `create or replace table model.prospective_player_outcomes as
      with players as (
        select
          season::integer as season,
          player_id::varchar as gsis_id,
          arg_max(team, week)::varchar as team,
          count(distinct week)::double as games,
          sum(coalesce(fantasy_points_ppr, 0))::double as ppr_points,
          sum(coalesce(carries, 0))::double as rush_attempts,
          sum(coalesce(receptions, 0))::double as receptions
        from source.nflverse_player_week_prospective
        where player_id is not null
        group by 1, 2
      )
      select players.*, teams.played as team_games_played, teams.scheduled as team_games_scheduled
      from players
      left join model.prospective_team_games teams
        on teams.season = players.season and teams.team = players.team`,
  ];
}

export interface ProspectiveSeasonStatus {
  readonly season: number;
  readonly regGamesScheduled: number;
  readonly regGamesPlayed: number;
  readonly lastWeekPlayed: number | null;
  readonly fetchedAt: string;
}

/** A season counts toward the release gate only when every scheduled regular-season game has a result. */
export function isRegularSeasonComplete(status: ProspectiveSeasonStatus): boolean {
  return status.regGamesScheduled > 0 && status.regGamesPlayed >= status.regGamesScheduled;
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
