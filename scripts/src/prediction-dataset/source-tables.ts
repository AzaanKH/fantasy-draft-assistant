import { EXCLUDES_FANTASYPROS, sqlString } from '../model/duckdb.js';

const SOURCE_URLS = {
  nflversePlayers:
    'https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet',
  nflverseSchedules:
    'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.parquet',
  nflverseNextGenPassing:
    'https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_passing.parquet',
  nflverseNextGenReceiving:
    'https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_receiving.parquet',
  nflverseNextGenRushing:
    'https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_rushing.parquet',
  dynastyProcessRankings:
    'https://github.com/dynastyprocess/data/raw/master/files/db_fpecr.parquet',
  dynastyProcessPlayerIds:
    'https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv',
} as const;

function sqlList(values: readonly string[]): string {
  return `[${values.map(sqlString).join(', ')}]`;
}

/** The exact seasons as a SQL `in` list, matching the per-season file URLs even when the window has gaps. */
export function sqlSeasonList(seasons: readonly number[]): string {
  if (seasons.length === 0) throw new Error('At least one season is required');
  for (const season of seasons) {
    if (!Number.isSafeInteger(season)) throw new Error(`Season must be an integer, got ${season}`);
  }
  return `(${seasons.join(', ')})`;
}

function nflverseSeasonUrls(
  release: string,
  filePrefix: string,
  seasons: readonly number[]
): string[] {
  return seasons.map(
    (season) =>
      `https://github.com/nflverse/nflverse-data/releases/download/${release}/${filePrefix}_${season}.parquet`
  );
}

function ffopportunityWeeklyUrls(seasons: readonly number[]): string[] {
  return seasons.map(
    (season) =>
      `https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_${season}.parquet`
  );
}

function nflverseParticipationUrls(seasons: readonly number[]): string[] {
  return seasons.map(
    (season) =>
      `https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_${season}.parquet`
  );
}

function nflversePbpUrls(seasons: readonly number[]): string[] {
  return seasons.map(
    (season) =>
      `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.parquet`
  );
}

/** Raw nflverse, ffopportunity and DynastyProcess tables in the `source` schema, for the given seasons. */
export function sourceTableStatements(seasons: readonly number[]): string[] {
  const seasonFilter = sqlSeasonList(seasons);
  return [
    `create schema if not exists source`,
    `create schema if not exists model`,

    `create or replace table source.nflverse_player_stats as
      select *
      from read_parquet(${sqlList(
        nflverseSeasonUrls('stats_player', 'stats_player_reg', seasons)
      )})`,
    `create or replace table source.nflverse_rosters as
      select *
      from read_parquet(${sqlList(nflverseSeasonUrls('rosters', 'roster', seasons))})`,
    `create or replace table source.nflverse_schedules as
      select *
      from read_parquet(${sqlString(SOURCE_URLS.nflverseSchedules)})
      where season in ${seasonFilter}`,
    `create or replace table source.nflverse_team_stats as
      select *
      from read_parquet(${sqlList(nflverseSeasonUrls('stats_team', 'stats_team_reg', seasons))})`,
    `create or replace table source.nflverse_player_ids as
      select *
      from read_parquet(${sqlString(SOURCE_URLS.nflversePlayers)})`,
    `create or replace table source.nflverse_snap_counts as
      select *
      from read_parquet(${sqlList(nflverseSeasonUrls('snap_counts', 'snap_counts', seasons))})`,
    `create or replace table source.nflverse_participation as
      select
        regexp_extract(nflverse_game_id, '^(\\d{4})', 1)::integer as season,
        nflverse_game_id::varchar as game_id,
        play_id::double as play_id,
        offense_players::varchar as offense_players,
        route::varchar as route,
        time_to_throw::double as time_to_throw,
        was_pressure::boolean as was_pressure,
        number_of_pass_rushers::double as number_of_pass_rushers
      from read_parquet(${sqlList(nflverseParticipationUrls(seasons))})`,
    `create or replace table source.nflverse_pbp as
      select
        season::integer as season,
        game_id::varchar as game_id,
        play_id::double as play_id,
        season_type::varchar as season_type,
        coalesce(qb_dropback, 0)::double as qb_dropback,
        coalesce(pass_attempt, 0)::double as pass_attempt,
        coalesce(rush_attempt, 0)::double as rush_attempt,
        coalesce(qb_kneel, 0)::double as qb_kneel,
        coalesce(sack, 0)::double as sack,
        yardline_100::double as yardline_100,
        passer_player_id::varchar as passer_player_id,
        receiver_player_id::varchar as receiver_player_id,
        rusher_player_id::varchar as rusher_player_id
      from read_parquet(${sqlList(nflversePbpUrls(seasons))})
      where season_type = 'REG'`,
    `create or replace table source.nflverse_nextgen_passing as
      select *
      from read_parquet(${sqlString(SOURCE_URLS.nflverseNextGenPassing)})
      where season in ${seasonFilter}`,
    `create or replace table source.nflverse_nextgen_receiving as
      select *
      from read_parquet(${sqlString(SOURCE_URLS.nflverseNextGenReceiving)})
      where season in ${seasonFilter}`,
    `create or replace table source.nflverse_nextgen_rushing as
      select *
      from read_parquet(${sqlString(SOURCE_URLS.nflverseNextGenRushing)})
      where season in ${seasonFilter}`,

    `create or replace table source.ffopportunity_weekly as
      select *
      from read_parquet(${sqlList(ffopportunityWeeklyUrls(seasons))})`,

    // Its rows are FantasyPros ECR, so the FantasyPros-free profile keeps only the columns.
    `create or replace table source.dynastyprocess_rankings as
      select *
      from read_parquet(${sqlString(SOURCE_URLS.dynastyProcessRankings)})
      ${EXCLUDES_FANTASYPROS ? 'limit 0' : ''}`,
    `create or replace table source.dynastyprocess_player_ids as
      select *
      from read_csv_auto(${sqlString(SOURCE_URLS.dynastyProcessPlayerIds)})`,
  ];
}
