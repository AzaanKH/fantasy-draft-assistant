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
 * season-to-date player outcomes with the team games played and scheduled across each player's team stints, and one
 * status row per season.
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

/** Derives match status and player outcomes with stint team games from the loaded schedule and weekly stats. */
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
    // A traded player's pace counts each team's games only while he was on it: a stint runs from his first week
    // with the team (the season start for his first team) to the week before his next team, and covers the games
    // he missed during it. Scaling by one team's games would misstate a player whose teams had different byes.
    `create or replace table model.prospective_player_outcomes as
      with player_weeks as (
        select
          weeks.season::integer as season,
          weeks.player_id::varchar as gsis_id,
          weeks.week::integer as week,
          weeks.team::varchar as team,
          weeks.game_id::varchar as game_id,
          weeks.fantasy_points_ppr,
          weeks.carries,
          weeks.receptions
        from source.nflverse_player_week_prospective weeks
        join model.prospective_matched_games matched on matched.game_id = weeks.game_id
        where weeks.player_id is not null
      ), players as (
        select
          season,
          gsis_id,
          arg_max(team, week)::varchar as team,
          count(distinct game_id)::double as games,
          sum(coalesce(fantasy_points_ppr, 0))::double as ppr_points,
          sum(coalesce(carries, 0))::double as rush_attempts,
          sum(coalesce(receptions, 0))::double as receptions
        from player_weeks
        group by 1, 2
      ), stint_starts as (
        select season, gsis_id, team, week as first_week
        from (
          select season, gsis_id, team, week,
            lag(team) over (partition by season, gsis_id order by week) as previous_team
          from (select distinct season, gsis_id, team, week from player_weeks)
        )
        where previous_team is distinct from team
      ), stints as (
        select season, gsis_id, team,
          case when row_number() over stint_order = 1 then 0 else first_week end as from_week,
          coalesce(lead(first_week) over stint_order - 1, 99) as to_week
        from stint_starts
        window stint_order as (partition by season, gsis_id order by first_week)
      ), team_weeks as (
        select schedules.season::integer as season, schedules.week::integer as week,
          schedules.home_team::varchar as team, schedules.game_id::varchar as game_id
        from source.nflverse_schedules_prospective schedules
        union all
        select schedules.season::integer, schedules.week::integer,
          schedules.away_team::varchar, schedules.game_id::varchar
        from source.nflverse_schedules_prospective schedules
      ), stint_games as (
        select stints.season, stints.gsis_id,
          count(distinct team_weeks.game_id)::integer as scheduled,
          count(distinct matched.game_id)::integer as played
        from stints
        join team_weeks
          on team_weeks.season = stints.season
          and team_weeks.team = stints.team
          and team_weeks.week between stints.from_week and stints.to_week
        left join model.prospective_matched_games matched on matched.game_id = team_weeks.game_id
        group by 1, 2
      )
      select players.*, stint_games.played as team_games_played, stint_games.scheduled as team_games_scheduled
      from players
      left join stint_games on stint_games.season = players.season and stint_games.gsis_id = players.gsis_id`,
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

/** Games each team plays in a regular season: the pace numerator, whatever a traded player's stints schedule. */
export const TEAM_SEASON_GAMES = 17;

/**
 * Season-to-date totals scaled to a 17-game pace by the team games played across the player's stints: a player who
 * misses games keeps the zeros, so injuries still count. Two stints can schedule 18 games when the teams' byes fall
 * on either side of a trade, but a season is 17 games, so 18 matched team games scale down. Players with no team
 * schedule are left unscaled; a complete season is scored on raw totals by the caller.
 */
export function fullSeasonPace(total: number, teamGamesPlayed: number | null): number {
  if (teamGamesPlayed === null || teamGamesPlayed <= 0) return total;
  return total * TEAM_SEASON_GAMES / teamGamesPlayed;
}
