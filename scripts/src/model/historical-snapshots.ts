import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';

import {
  MODEL_PATHS,
  runStatements,
  sqlString,
} from './duckdb.js';
import { assertInformationCutoff } from './historical-snapshot-core.js';

interface RawSleeperDraft {
  readonly draft_id?: string;
  readonly league_id?: string;
  readonly season?: string;
  readonly start_time?: number;
}

interface DraftCutoff {
  readonly season: number;
  readonly draftId: string;
  readonly leagueId: string;
  readonly draftTimestamp: string;
}

interface CoverageRow {
  readonly season: number | bigint;
  readonly draft_id: string;
  readonly draft_timestamp: string;
  readonly players: number | bigint;
  readonly with_team: number | bigint;
  readonly with_roster_status: number | bigint;
  readonly with_active_status: number | bigint;
  readonly with_pup_status: number | bigint;
  readonly with_ir_status: number | bigint;
  readonly with_injury_designation: number | bigint;
  readonly with_depth_chart: number | bigint;
  readonly with_prior_season_missed_games: number | bigint;
  readonly with_same_position_competition: number | bigint;
  readonly with_recent_trade: number | bigint;
  readonly cutoff_violations: number | bigint;
}

interface ValidationRow {
  readonly season: number | bigint;
  readonly sleeper_player_id: string | null;
  readonly max_information_timestamp: string | null;
  readonly draft_timestamp: string;
}

const RANKINGS_URL =
  'https://github.com/dynastyprocess/data/raw/master/files/db_fpecr.parquet';
const PLAYER_IDS_URL =
  'https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv';
const SCHEDULES_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.parquet';
const TRADES_URL =
  'https://raw.githubusercontent.com/nflverse/nfldata/master/data/trades.csv';

function seasonUrls(release: string, prefix: string, seasons: readonly number[]): readonly string[] {
  return seasons.map(
    (season) =>
      `https://github.com/nflverse/nflverse-data/releases/download/${release}/${prefix}_${season}.parquet`
  );
}

function sqlList(values: readonly string[]): string {
  return `[${values.map(sqlString).join(', ')}]`;
}

async function loadDraftCutoffs(): Promise<readonly DraftCutoff[]> {
  const fileNames = (await readdir(MODEL_PATHS.leagueDraftRawDir))
    .filter((fileName) => /^\d{4}-draft\.json$/.test(fileName))
    .sort();

  const cutoffs = await Promise.all(
    fileNames.map(async (fileName): Promise<DraftCutoff> => {
      const draft = JSON.parse(
        await readFile(join(MODEL_PATHS.leagueDraftRawDir, fileName), 'utf8')
      ) as RawSleeperDraft;
      const season = Number(draft.season);
      if (
        !Number.isInteger(season) ||
        typeof draft.draft_id !== 'string' ||
        typeof draft.league_id !== 'string' ||
        typeof draft.start_time !== 'number'
      ) {
        throw new Error(`Historical draft file lacks an exact start timestamp: ${fileName}`);
      }

      return {
        season,
        draftId: draft.draft_id,
        leagueId: draft.league_id,
        draftTimestamp: new Date(draft.start_time).toISOString(),
      };
    })
  );

  if (cutoffs.length === 0) {
    throw new Error('No historical Sleeper draft cutoffs were found.');
  }
  return cutoffs;
}

function draftValuesSql(cutoffs: readonly DraftCutoff[]): string {
  return cutoffs
    .map(
      (cutoff) =>
        `(${cutoff.season}, ${sqlString(cutoff.draftId)}, ${sqlString(cutoff.leagueId)}, ` +
        `timestamptz ${sqlString(cutoff.draftTimestamp)})`
    )
    .join(',\n');
}

function normalizeCount(value: number | bigint): number {
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number | bigint {
  return typeof value === 'number' || typeof value === 'bigint';
}

function isValidationRow(value: unknown): value is ValidationRow {
  return (
    isRecord(value) &&
    isCount(value['season']) &&
    (value['sleeper_player_id'] === null || typeof value['sleeper_player_id'] === 'string') &&
    (value['max_information_timestamp'] === null ||
      typeof value['max_information_timestamp'] === 'string') &&
    typeof value['draft_timestamp'] === 'string'
  );
}

function isCoverageRow(value: unknown): value is CoverageRow {
  return (
    isRecord(value) &&
    isCount(value['season']) &&
    typeof value['draft_id'] === 'string' &&
    typeof value['draft_timestamp'] === 'string' &&
    isCount(value['players']) &&
    isCount(value['with_team']) &&
    isCount(value['with_roster_status']) &&
    isCount(value['with_active_status']) &&
    isCount(value['with_pup_status']) &&
    isCount(value['with_ir_status']) &&
    isCount(value['with_injury_designation']) &&
    isCount(value['with_depth_chart']) &&
    isCount(value['with_prior_season_missed_games']) &&
    isCount(value['with_same_position_competition']) &&
    isCount(value['with_recent_trade']) &&
    isCount(value['cutoff_violations'])
  );
}

function validateRows<Row>(
  rows: readonly unknown[],
  guard: (value: unknown) => value is Row,
  label: string
): Row[] {
  const validRows: Row[] = [];
  for (const [index, row] of rows.entries()) {
    if (!guard(row)) {
      throw new Error(`DuckDB returned an invalid ${label} row at index ${String(index)}.`);
    }
    validRows.push(row);
  }
  return validRows;
}

export async function buildHistoricalSnapshots(connection: DuckDBConnection): Promise<void> {
  const cutoffs = await loadDraftCutoffs();
  const seasons = cutoffs.map((cutoff) => cutoff.season);
  const priorSeasons = [...new Set(seasons.map((season) => season - 1))].sort();
  const legacyDepthSeasons = seasons.filter((season) => season <= 2024);
  const timestampedDepthSeasons = seasons.filter((season) => season >= 2025);

  await runStatements(connection, [
    `set timezone = 'UTC'`,
    `create schema if not exists source`,
    `create schema if not exists model`,
    `create or replace table model.historical_draft_dates as
      select * from (values
        ${draftValuesSql(cutoffs)}
      ) as drafts(season, draft_id, league_id, draft_timestamp)`,
    `create or replace table source.historical_snapshot_rankings as
      select * from read_parquet(${sqlString(RANKINGS_URL)})`,
    `create or replace table source.historical_snapshot_player_ids as
      select * from read_csv_auto(${sqlString(PLAYER_IDS_URL)})`,
    `create or replace table source.historical_snapshot_prior_stats as
      select * from read_parquet(${sqlList(seasonUrls('stats_player', 'stats_player_reg', priorSeasons))})`,
    `create or replace table source.historical_snapshot_schedules as
      select * from read_parquet(${sqlString(SCHEDULES_URL)})
      where season in (${priorSeasons.join(', ')})`,
    `create or replace table source.historical_snapshot_injuries as
      select
        season::integer as season,
        team::varchar as team,
        gsis_id::varchar as gsis_id,
        position::varchar as position,
        full_name::varchar as player_name,
        report_primary_injury::varchar as report_primary_injury,
        report_secondary_injury::varchar as report_secondary_injury,
        report_status::varchar as report_status,
        practice_status::varchar as practice_status,
        date_modified::timestamptz as information_timestamp,
        concat(filename, '#', file_row_number)::varchar as source_row_key
      from read_parquet(
        ${sqlList(seasonUrls('injuries', 'injuries', seasons))},
        union_by_name = true,
        filename = true,
        file_row_number = true
      )`,
    legacyDepthSeasons.length > 0
      ? `create or replace table source.historical_snapshot_depth_legacy as
          select
            season::integer as season,
            club_code::varchar as team,
            gsis_id::varchar as gsis_id,
            full_name::varchar as player_name,
            depth_position::varchar as depth_position,
            try_cast(depth_team as integer) as depth_rank,
            null::timestamptz as information_timestamp,
            'legacy weekly depth chart has no per-record timestamp'::varchar as source_gap,
            null::varchar as source_row_key
          from read_parquet(${sqlList(
            seasonUrls('depth_charts', 'depth_charts', legacyDepthSeasons)
          )})`
      : `create or replace table source.historical_snapshot_depth_legacy (
          season integer, team varchar, gsis_id varchar, player_name varchar,
          depth_position varchar, depth_rank integer, information_timestamp timestamptz,
          source_gap varchar, source_row_key varchar
        )`,
    timestampedDepthSeasons.length > 0
      ? `create or replace table source.historical_snapshot_depth_timestamped as
          select
            regexp_extract(filename, '_(\\d{4})\\.parquet$', 1)::integer as season,
            team::varchar as team,
            gsis_id::varchar as gsis_id,
            player_name::varchar as player_name,
            pos_abb::varchar as depth_position,
            pos_rank::integer as depth_rank,
            try_cast(dt as timestamptz) as information_timestamp,
            null::varchar as source_gap,
            concat(filename, '#', file_row_number)::varchar as source_row_key
          from read_parquet(${sqlList(
            seasonUrls('depth_charts', 'depth_charts', timestampedDepthSeasons)
          )}, union_by_name = true, filename = true, file_row_number = true)`
      : `create or replace table source.historical_snapshot_depth_timestamped (
          season integer, team varchar, gsis_id varchar, player_name varchar,
          depth_position varchar, depth_rank integer, information_timestamp timestamptz,
          source_gap varchar, source_row_key varchar
        )`,
    `create or replace table source.historical_snapshot_depth as
      select * from source.historical_snapshot_depth_legacy
      union all by name
      select * from source.historical_snapshot_depth_timestamped`,
    `create or replace table source.historical_snapshot_rosters as
      select
        season::integer as season,
        team::varchar as team,
        gsis_id::varchar as gsis_id,
        full_name::varchar as player_name,
        status::varchar as roster_status,
        status_description_abbr::varchar as status_description,
        null::timestamptz as information_timestamp,
        'weekly roster has no preseason row or per-record timestamp'::varchar as source_gap
      from read_parquet(${sqlList(
        seasonUrls('weekly_rosters', 'roster_weekly', seasons)
      )}, union_by_name = true)`,
    `create or replace table source.historical_snapshot_trades as
      select * from read_csv_auto(${sqlString(TRADES_URL)})`,
    `create or replace table model.historical_asof_player_ids as
      select * exclude (recency_rank)
      from (
        select
          drafts.season,
          ids.fantasypros_id::varchar as fantasypros_id,
          ids.sleeper_id::varchar as sleeper_player_id,
          ids.gsis_id::varchar as gsis_id,
          ids.pfr_id::varchar as pfr_id,
          row_number() over (
            partition by drafts.season, ids.fantasypros_id
            order by try_cast(ids.db_season as integer) desc nulls last
          ) as recency_rank
        from model.historical_draft_dates drafts
        cross join source.historical_snapshot_player_ids ids
        where ids.fantasypros_id is not null
      )
      where recency_rank = 1`,
    `create or replace table model.historical_asof_player_universe as
      with eligible_dates as (
        select
          drafts.season,
          max(cast(rankings.scrape_date as date)) as ranking_source_date
        from model.historical_draft_dates drafts
        join source.historical_snapshot_rankings rankings
          on extract(year from cast(rankings.scrape_date as date)) = drafts.season
        where rankings.page_type in ('redraft-overall', 'best-overall')
          and (cast(rankings.scrape_date as date) + interval 1 day)::timestamptz
            <= drafts.draft_timestamp
        group by drafts.season
      ), eligible as (
        select
          drafts.season,
          drafts.draft_id,
          drafts.league_id,
          drafts.draft_timestamp,
          rankings.id::varchar as fantasypros_id,
          rankings.player::varchar as player_name,
          rankings.pos::varchar as position,
          coalesce(rankings.team, rankings.tm)::varchar as team,
          rankings.ecr::double as predraft_ecr,
          rankings.sd::double as predraft_rank_sd,
          rankings.best::double as predraft_best_rank,
          rankings.worst::double as predraft_worst_rank,
          rankings.page_type::varchar as ranking_type,
          cast(rankings.scrape_date as date) as ranking_source_date,
          (cast(rankings.scrape_date as date) + interval 1 day)::timestamptz
            as ranking_information_timestamp_upper_bound,
          row_number() over (
            partition by drafts.season, rankings.id
            order by cast(rankings.scrape_date as date) desc,
              case when rankings.page_type = 'redraft-overall' then 0 else 1 end
          ) as recency_rank
        from model.historical_draft_dates drafts
        join eligible_dates
          on drafts.season = eligible_dates.season
        join source.historical_snapshot_rankings rankings
          on extract(year from cast(rankings.scrape_date as date)) = drafts.season
          and cast(rankings.scrape_date as date) = eligible_dates.ranking_source_date
        where rankings.page_type in ('redraft-overall', 'best-overall')
          and rankings.pos in ('QB', 'RB', 'WR', 'TE', 'K', 'DST')
          and rankings.id is not null
          and rankings.player <> 'Player Name'
          and try_cast(rankings.ecr as double) > 0
          and (cast(rankings.scrape_date as date) + interval 1 day)::timestamptz
            <= drafts.draft_timestamp
      )
      select
        eligible.* exclude (recency_rank),
        ids.sleeper_player_id,
        ids.gsis_id,
        ids.pfr_id
      from eligible
      left join model.historical_asof_player_ids ids
        on eligible.season = ids.season
        and eligible.fantasypros_id = ids.fantasypros_id
      where eligible.recency_rank = 1`,
    `create or replace table model.historical_prior_season_availability as
      with team_games as (
        select season, team, count(distinct game_id)::integer as scheduled_games
        from (
          select season, game_id, home_team as team
          from source.historical_snapshot_schedules where game_type = 'REG'
          union all
          select season, game_id, away_team as team
          from source.historical_snapshot_schedules where game_type = 'REG'
        )
        group by season, team
      )
      select
        universe.season,
        universe.gsis_id,
        stats.season::integer as prior_season,
        stats.recent_team::varchar as prior_season_team,
        stats.games::integer as prior_season_games_played,
        team_games.scheduled_games as prior_season_team_games,
        case
          when stats.games is null or team_games.scheduled_games is null then null
          else greatest(0, team_games.scheduled_games - stats.games)::integer
        end as prior_season_missed_games,
        case when stats.player_id is not null
          then make_timestamptz(universe.season, 3, 1, 0, 0, 0, 'UTC')
        end as information_timestamp_upper_bound
      from model.historical_asof_player_universe universe
      left join source.historical_snapshot_prior_stats stats
        on universe.gsis_id = stats.player_id
        and stats.season = universe.season - 1
      left join team_games
        on stats.season = team_games.season
        and stats.recent_team = team_games.team`,
    `create or replace table model.historical_asof_injuries as
      select * exclude (recency_rank)
      from (
        select
          universe.season,
          injuries.* exclude (season),
          row_number() over (
            partition by universe.season, universe.gsis_id
            order by injuries.information_timestamp desc, injuries.source_row_key desc
          ) as recency_rank
        from model.historical_asof_player_universe universe
        join source.historical_snapshot_injuries injuries
          on universe.season = injuries.season
          and universe.gsis_id = injuries.gsis_id
          and injuries.information_timestamp <= universe.draft_timestamp
      )
      where recency_rank = 1`,
    `create or replace table model.historical_asof_depth as
      select * exclude (recency_rank)
      from (
        select
          universe.season,
          depth.* exclude (season),
          row_number() over (
            partition by universe.season, universe.gsis_id
            order by depth.information_timestamp desc, depth.source_row_key desc
          ) as recency_rank
        from model.historical_asof_player_universe universe
        join source.historical_snapshot_depth depth
          on universe.season = depth.season
          and universe.gsis_id = depth.gsis_id
          and depth.information_timestamp <= universe.draft_timestamp
      )
      where recency_rank = 1`,
    `create or replace table model.historical_asof_rosters as
      select * exclude (recency_rank)
      from (
        select
          universe.season,
          rosters.* exclude (season),
          row_number() over (
            partition by universe.season, universe.gsis_id
            order by rosters.information_timestamp desc
          ) as recency_rank
        from model.historical_asof_player_universe universe
        join source.historical_snapshot_rosters rosters
          on universe.season = rosters.season
          and universe.gsis_id = rosters.gsis_id
          and rosters.information_timestamp <= universe.draft_timestamp
      )
      where recency_rank = 1`,
    `create or replace table model.historical_asof_competition as
      select
        player.season,
        player.fantasypros_id,
        count(competitor.fantasypros_id)::integer as same_position_competitor_count,
        list(competitor.player_name order by competitor.predraft_ecr)
          filter (where competitor.fantasypros_id is not null) as same_position_competitor_names,
        list(competitor.predraft_ecr order by competitor.predraft_ecr)
          filter (where competitor.fantasypros_id is not null) as same_position_competitor_ecrs
      from model.historical_asof_player_universe player
      left join model.historical_asof_player_universe competitor
        on player.season = competitor.season
        and player.team = competitor.team
        and player.position = competitor.position
        and player.fantasypros_id <> competitor.fantasypros_id
        and competitor.predraft_ecr <= 300
      group by player.season, player.fantasypros_id`,
    `create or replace table model.historical_asof_trades as
      select
        universe.season,
        universe.fantasypros_id,
        count(*)::integer as recent_trade_count,
        max(cast(trades.trade_date as date)) as latest_trade_date,
        list(
          concat(cast(trades.trade_date as date), ': ', trades.gave, ' -> ', trades.received)
          order by cast(trades.trade_date as date) desc
        ) as recent_trade_summaries,
        max((cast(trades.trade_date as date) + interval 1 day)::timestamptz)
          as information_timestamp_upper_bound
      from model.historical_asof_player_universe universe
      join source.historical_snapshot_trades trades
        on universe.pfr_id = trades.pfr_id
        and cast(trades.trade_date as date) >= cast(universe.draft_timestamp as date) - interval 180 day
        and (cast(trades.trade_date as date) + interval 1 day)::timestamptz
          <= universe.draft_timestamp
      group by universe.season, universe.fantasypros_id`,
    `create or replace table model.historical_asof_snapshots as
      select
        snapshot.* exclude (latest_information_timestamp),
        snapshot.latest_information_timestamp as max_information_timestamp,
        snapshot.latest_information_timestamp > snapshot.draft_timestamp as cutoff_violation
      from (
      select
        universe.season,
        universe.draft_id,
        universe.league_id,
        universe.draft_timestamp,
        universe.fantasypros_id,
        universe.sleeper_player_id,
        universe.gsis_id,
        universe.pfr_id,
        universe.player_name,
        case when universe.position = 'DST' then 'DEF' else universe.position end as position,
        universe.team,
        'DynastyProcess pre-draft rankings'::varchar as team_source,
        universe.ranking_information_timestamp_upper_bound
          as team_information_timestamp_upper_bound,
        universe.predraft_ecr,
        universe.predraft_rank_sd,
        universe.ranking_source_date,
        universe.ranking_information_timestamp_upper_bound,
        rosters.roster_status,
        rosters.status_description as roster_status_description,
        rosters.information_timestamp as roster_information_timestamp,
        case when rosters.roster_status is null then null
          else upper(rosters.roster_status) in ('ACT', 'ACTIVE') end as is_active,
        case when rosters.roster_status is null then null
          else upper(rosters.roster_status) like '%PUP%' end as is_pup,
        case when rosters.roster_status is null then null
          else upper(rosters.roster_status) in ('RES', 'IR')
            or lower(coalesce(rosters.status_description, '')) like '%injured reserve%' end as is_ir,
        injuries.report_primary_injury as injury_primary,
        injuries.report_secondary_injury as injury_secondary,
        injuries.report_status as injury_designation,
        injuries.practice_status,
        injuries.information_timestamp as injury_information_timestamp,
        prior.prior_season,
        prior.prior_season_team,
        prior.prior_season_games_played,
        prior.prior_season_team_games,
        prior.prior_season_missed_games,
        prior.information_timestamp_upper_bound
          as prior_season_availability_information_timestamp_upper_bound,
        depth.depth_position,
        depth.depth_rank,
        depth.information_timestamp as depth_information_timestamp,
        competition.same_position_competitor_count,
        competition.same_position_competitor_names,
        competition.same_position_competitor_ecrs,
        universe.ranking_information_timestamp_upper_bound
          as competition_information_timestamp_upper_bound,
        coalesce(trades.recent_trade_count, 0) as recent_trade_count,
        trades.latest_trade_date,
        trades.recent_trade_summaries,
        trades.information_timestamp_upper_bound
          as recent_transactions_information_timestamp_upper_bound,
        'nflverse/nfldata trades only; signings, waivers, and cuts unavailable'::varchar
          as recent_transactions_coverage,
        false as recent_transactions_complete,
        case when rosters.roster_status is null
          then 'no timestamped preseason roster record at or before cutoff' end
          as roster_status_missing_reason,
        case when injuries.gsis_id is null
          then 'no timestamped preseason injury record at or before cutoff' end
          as injury_missing_reason,
        case when depth.gsis_id is null
          then 'no timestamped preseason depth-chart record at or before cutoff' end
          as depth_chart_missing_reason,
        greatest(
          universe.ranking_information_timestamp_upper_bound,
          prior.information_timestamp_upper_bound,
          rosters.information_timestamp,
          injuries.information_timestamp,
          depth.information_timestamp,
          trades.information_timestamp_upper_bound
        ) as latest_information_timestamp
      from model.historical_asof_player_universe universe
      left join model.historical_prior_season_availability prior
        on universe.season = prior.season and universe.gsis_id = prior.gsis_id
      left join model.historical_asof_rosters rosters
        on universe.season = rosters.season and universe.gsis_id = rosters.gsis_id
      left join model.historical_asof_injuries injuries
        on universe.season = injuries.season and universe.gsis_id = injuries.gsis_id
      left join model.historical_asof_depth depth
        on universe.season = depth.season and universe.gsis_id = depth.gsis_id
      left join model.historical_asof_competition competition
        on universe.season = competition.season
        and universe.fantasypros_id = competition.fantasypros_id
      left join model.historical_asof_trades trades
        on universe.season = trades.season
        and universe.fantasypros_id = trades.fantasypros_id
      ) snapshot`,
    `copy model.historical_asof_snapshots
      to ${sqlString(MODEL_PATHS.historicalSnapshotsParquet)}
      (format parquet, compression zstd)`,
  ]);

  const validationReader = await connection.runAndReadAll(`
    select
      season,
      sleeper_player_id,
      cast(max_information_timestamp as varchar) as max_information_timestamp,
      cast(draft_timestamp as varchar) as draft_timestamp
    from model.historical_asof_snapshots
    where cutoff_violation
  `);
  const violations = validateRows(
    validationReader.getRowObjects(),
    isValidationRow,
    'historical snapshot validation'
  );
  for (const violation of violations) {
    assertInformationCutoff(
      violation.max_information_timestamp,
      violation.draft_timestamp,
      `${String(violation.season)} player ${violation.sleeper_player_id ?? 'unknown'}`
    );
  }

  const coverageReader = await connection.runAndReadAll(`
    select
      season,
      any_value(draft_id) as draft_id,
      cast(any_value(draft_timestamp) as varchar) as draft_timestamp,
      count(*) as players,
      count(team) as with_team,
      count(roster_status) as with_roster_status,
      count(is_active) filter (where is_active) as with_active_status,
      count(is_pup) filter (where is_pup) as with_pup_status,
      count(is_ir) filter (where is_ir) as with_ir_status,
      count(injury_designation) as with_injury_designation,
      count(depth_rank) as with_depth_chart,
      count(prior_season_missed_games) as with_prior_season_missed_games,
      count(*) filter (where same_position_competitor_count > 0)
        as with_same_position_competition,
      count(*) filter (where recent_trade_count > 0) as with_recent_trade,
      count(*) filter (where cutoff_violation) as cutoff_violations
    from model.historical_asof_snapshots
    group by season
    order by season
  `);
  const coverageRows = validateRows(
    coverageReader.getRowObjects(),
    isCoverageRow,
    'historical snapshot coverage'
  );
  const report = {
    generatedAt: new Date().toISOString(),
    rule: 'information_timestamp <= historical_draft_timestamp',
    dateOnlyPolicy: 'information timestamp upper bound is the following midnight UTC',
    missingnessPolicy: 'unknown timestamps and absent preseason rows remain null; no later rows are inferred',
    output: 'data/model/historical-asof-snapshots.parquet',
    sources: {
      rankings: RANKINGS_URL,
      playerIds: PLAYER_IDS_URL,
      injuries: 'nflverse weekly injuries; timestamped rows only',
      rosters: 'nflverse weekly rosters; no eligible preseason timestamps in these seasons',
      depthCharts: 'nflverse weekly/date depth charts; timestamped rows only',
      transactions: `${TRADES_URL} (trades only)`,
    },
    seasons: coverageRows.map((row) => ({
      season: normalizeCount(row.season),
      draftId: row.draft_id,
      draftTimestamp: row.draft_timestamp,
      players: normalizeCount(row.players),
      withTeam: normalizeCount(row.with_team),
      withRosterStatus: normalizeCount(row.with_roster_status),
      active: normalizeCount(row.with_active_status),
      pup: normalizeCount(row.with_pup_status),
      ir: normalizeCount(row.with_ir_status),
      withInjuryDesignation: normalizeCount(row.with_injury_designation),
      withDepthChart: normalizeCount(row.with_depth_chart),
      withPriorSeasonMissedGames: normalizeCount(row.with_prior_season_missed_games),
      withSamePositionCompetition: normalizeCount(row.with_same_position_competition),
      withRecentTrade: normalizeCount(row.with_recent_trade),
      cutoffViolations: normalizeCount(row.cutoff_violations),
    })),
  };
  await writeFile(MODEL_PATHS.historicalSnapshotReportJson, `${JSON.stringify(report, null, 2)}\n`);
}
