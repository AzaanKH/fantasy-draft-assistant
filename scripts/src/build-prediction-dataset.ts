/**
 * Builds the model-ready fantasy football datasets from historical sources.
 *
 * Source responsibilities:
 * - nflreadpy / nflverse: historical NFL stats, snap share, Next Gen Stats, rosters,
 *   schedules, team stats, and player IDs
 * - ffopportunity / ffverse: expected fantasy points and opportunity metrics
 * - DynastyProcess / ffverse rankings: historical pre-draft and market-style rankings
 *
 * Usage:
 *   pnpm --filter scripts model:duckdb:init
 *   pnpm --filter scripts model:dataset
 */

import { access, writeFile } from 'node:fs/promises';
import {
  BACKTESTS_MODEL_DIR,
  MODEL_PATHS,
  connectModelDb,
  readJsonFile,
  runStatements,
  sqlString,
} from './model/duckdb.js';
import { CURRENT_LEAGUE_SCORING_ADJUSTMENTS } from './model/league-scoring.js';
import { buildHistoricalSnapshots } from './model/historical-snapshots.js';
import {
  OFFENSIVE_POSITIONS,
  POSITION_FEATURES,
  fitAllPositionResidualModelsForSeason,
  type FittedPositionResidualModel,
  type OffensivePosition,
  type PositionResidualRow,
} from './model/position-residual-model.js';

interface FantasyProsSnapshot {
  readonly metadata?: {
    readonly season?: number;
  };
}

interface CountRow {
  readonly table_name: string;
  readonly row_count: bigint;
}

interface PredictionRow {
  readonly player_id: string | bigint;
  readonly player_name: string;
  readonly position: string;
  readonly team: string;
  readonly base_projected_points: number | bigint;
  readonly usage_efficiency_adjustment: number | bigint;
  readonly custom_scoring_adjustment: number | bigint;
  readonly projected_points: number | bigint;
  readonly floor_projected_points: number | bigint;
  readonly ceiling_projected_points: number | bigint;
  readonly position_percentile: number | bigint;
  readonly value_over_replacement: number | bigint;
  readonly ceiling_score: number | bigint;
  readonly floor_score: number | bigint;
  readonly uncertainty_score: number | bigint;
  readonly injury_risk_score: number | bigint;
  readonly model_family: string;
}

interface ResidualTrainingDbRow {
  readonly season: number | bigint;
  readonly position: string;
  readonly target_residual: number | bigint;
  readonly [featureName: string]: string | number | bigint | null;
}

const SOURCE_RESPONSIBILITIES = {
  nflverse: [
    'historical NFL player stats',
    'historical offensive snap share',
    'play-level pressure, participation, and charted primary-receiver routes',
    'play-by-play inside-the-five carries and targets',
    'historical Next Gen Stats efficiency',
    'historical rosters',
    'timestamp-gated historical injury, roster, and depth-chart snapshots',
    'prior-season missed games and dated trades as of each historical draft',
    'historical schedules',
    'historical team stats',
    'player ID mapping',
  ],
  ffopportunity: [
    'expected fantasy points',
    'expected yardage/touchdown opportunity',
    'team opportunity share metrics',
  ],
  dynastyprocess: [
    'historical pre-draft rankings',
    'market-style redraft rankings',
    'cross-platform fantasy player IDs',
  ],
  predictionLayer: [
    'uses nflverse production/history',
    'uses walk-forward fitted, centered position residuals',
    'shrinks efficiency features by position workload using training-only baselines and thresholds',
    'uses leakage-safe trailing pressure, route, goal-line, snap, and Next Gen Stats features',
    'uses ffopportunity expected points/opportunity',
    'uses DynastyProcess pre-draft ranking context',
    'uses as-of-draft availability and role context only as model inputs, never as point awards',
  ],
  rosterAwareRecommendation: [
    'uses prediction outputs',
    'uses current FantasyPros',
    'uses current Sleeper search_rank platform proxy',
    'uses team needs',
  ],
  leagueHistorySurvivalModel: [
    'uses imported Sleeper draft IDs',
    'uses historical pick outcomes',
    'uses current Sleeper platform proxy and historical ranking context',
  ],
  draftPickTradeGrader: [
    'uses prediction layer',
    'uses survival model',
    'uses roster-aware recommendation inputs',
  ],
} as const;

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

function positionModelFamily(model: FittedPositionResidualModel): string {
  return `${model.position.toLowerCase()}-ridge-${model.specificationId}`;
}

const REPLACEMENT_RANK_SQL = `
  case position
    when 'QB' then 12
    when 'RB' then 30
    when 'WR' then 30
    when 'TE' then 14
    when 'K' then 12
    else 12
  end
`;
const RUSH_ATTEMPT_BONUS = CURRENT_LEAGUE_SCORING_ADJUSTMENTS.rushAttemptBonus;
const TE_RECEPTION_BONUS = CURRENT_LEAGUE_SCORING_ADJUSTMENTS.teReceptionBonus;

function sqlList(values: readonly string[]): string {
  return `[${values.map(sqlString).join(', ')}]`;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function asNumber(value: number | bigint): number {
  return Number(value);
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

function coefficientValuesSql(models: Readonly<Record<OffensivePosition, FittedPositionResidualModel>>): string {
  const rows = OFFENSIVE_POSITIONS.flatMap((position) => {
    const model = models[position];
    return model.featureNames.map((featureName, index) => `(
      ${sqlString(position)},
      ${sqlString(positionModelFamily(model))},
      ${sqlString(model.candidateSetVersion)},
      ${sqlString(model.specificationId)},
      ${model.selectionValidationSeason ?? 'null'},
      ${model.trainingSeasons[model.trainingSeasons.length - 1] ?? 0},
      ${model.lambda},
      ${model.volumeThreshold},
      ${sqlString(featureName)},
      ${model.featureMeans[index] ?? 0},
      ${model.featureScales[index] ?? 1},
      ${model.coefficients[index] ?? 0},
      ${model.trainingRows},
      ${model.targetResidualMean},
      ${model.residualCap}
    )`);
  });
  return rows.join(',\n');
}

function residualExpression(model: FittedPositionResidualModel): string {
  const terms = model.featureNames.map((featureName, index) => {
    const featureMean = model.featureMeans[index] ?? 0;
    const featureScale = model.featureScales[index] ?? 1;
    const coefficient = model.coefficients[index] ?? 0;
    return `(
              coalesce(greatest(trailing_player_volume_3yr, 0), 0)
                / (coalesce(greatest(trailing_player_volume_3yr, 0), 0) + ${model.volumeThreshold})
              * (coalesce(${featureName}, ${featureMean}) - ${featureMean})
              / ${featureScale}
            ) * ${coefficient}`;
  });
  const prediction = terms.length > 0 ? terms.join('\n            + ') : '0';
  return prediction;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getSeasonWindow(currentSeason: number): readonly number[] {
  const completedSeason = currentSeason - 1;
  const envStart = Number(process.env['MODEL_HISTORY_START_SEASON']);
  const envEnd = Number(process.env['MODEL_HISTORY_END_SEASON']);
  const start = Number.isInteger(envStart) ? envStart : Math.max(2021, completedSeason - 4);
  const end = Number.isInteger(envEnd) ? envEnd : completedSeason;
  return range(start, end);
}

async function main(): Promise<void> {
  const snapshot = await readJsonFile<FantasyProsSnapshot>(MODEL_PATHS.fantasyProsSnapshotJson);
  const currentSeason = snapshot.metadata?.season ?? new Date().getFullYear();
  const seasons = getSeasonWindow(currentSeason);
  const modelVersion =
    `position-ridge-v4-nested-selection-${seasons[0]}-${seasons[seasons.length - 1]}`;
  const hasLeagueHistory = await exists(MODEL_PATHS.leagueDraftHistoryJson);
  const connection = await connectModelDb();

  try {
    await buildHistoricalSnapshots(connection);
    await runStatements(connection, [
      `create schema if not exists source`,
      `create schema if not exists model`,

      /**
       * nflreadpy / nflverse responsibility:
       * historical NFL stats, rosters, schedules, team stats, and player IDs.
       */
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
        where season between ${seasons[0]} and ${seasons[seasons.length - 1]}`,
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
        where season between ${seasons[0]} and ${seasons[seasons.length - 1]}`,
      `create or replace table source.nflverse_nextgen_receiving as
        select *
        from read_parquet(${sqlString(SOURCE_URLS.nflverseNextGenReceiving)})
        where season between ${seasons[0]} and ${seasons[seasons.length - 1]}`,
      `create or replace table source.nflverse_nextgen_rushing as
        select *
        from read_parquet(${sqlString(SOURCE_URLS.nflverseNextGenRushing)})
        where season between ${seasons[0]} and ${seasons[seasons.length - 1]}`,

      /**
       * ffopportunity / ffverse responsibility:
       * expected fantasy points and opportunity metrics.
       */
      `create or replace table source.ffopportunity_weekly as
        select *
        from read_parquet(${sqlList(ffopportunityWeeklyUrls(seasons))})`,

      /**
       * DynastyProcess / ffverse rankings responsibility:
       * historical pre-draft / market-style rankings and fantasy IDs.
       */
      `create or replace table source.dynastyprocess_rankings as
        select *
        from read_parquet(${sqlString(SOURCE_URLS.dynastyProcessRankings)})`,
      `create or replace table source.dynastyprocess_player_ids as
        select *
        from read_csv_auto(${sqlString(SOURCE_URLS.dynastyProcessPlayerIds)})`,

      `create or replace table model.nflverse_player_seasons as
        select
          season::integer as season,
          player_id::varchar as gsis_id,
          player_display_name::varchar as player_name,
          position::varchar as position,
          recent_team::varchar as team,
          games::double as games,
          fantasy_points_ppr::double as fantasy_points_ppr,
          fantasy_points::double as fantasy_points_standard,
          attempts::double as pass_attempts,
          carries::double as rush_attempts,
          targets::double as targets,
          receptions::double as receptions,
          passing_yards::double as passing_yards,
          rushing_yards::double as rushing_yards,
          receiving_yards::double as receiving_yards,
          target_share::double as target_share,
          air_yards_share::double as air_yards_share,
          wopr::double as wopr
        from source.nflverse_player_stats
        where position in ('QB', 'RB', 'WR', 'TE', 'K')`,
      `create or replace table model.nflverse_team_seasons as
        select
          season::integer as season,
          team::varchar as team,
          games::double as games,
          attempts::double as pass_attempts,
          carries::double as rush_attempts,
          passing_yards::double as passing_yards,
          rushing_yards::double as rushing_yards,
          passing_tds::double as passing_tds,
          rushing_tds::double as rushing_tds,
          receiving_tds::double as receiving_tds
        from source.nflverse_team_stats`,
      `create or replace table model.nflverse_snap_seasons as
        select
          snaps.season::integer as season,
          ids.gsis_id::varchar as gsis_id,
          sum(snaps.offense_snaps)::double as offense_snaps,
          avg(snaps.offense_pct) filter (where snaps.offense_snaps > 0)::double
            as offense_snap_share
        from source.nflverse_snap_counts snaps
        join source.nflverse_player_ids ids
          on snaps.pfr_player_id = ids.pfr_id
        where snaps.game_type = 'REG'
          and snaps.position in ('QB', 'RB', 'WR', 'TE')
        group by snaps.season, ids.gsis_id`,
      `create or replace table model.nflverse_pressure_seasons as
        select
          pbp.season,
          pbp.passer_player_id as gsis_id,
          count(*)::double as pressure_dropbacks,
          avg(participation.was_pressure::integer)::double as pressure_rate,
          avg(participation.time_to_throw)::double as pressure_time_to_throw,
          avg(participation.number_of_pass_rushers)::double as number_of_pass_rushers
        from source.nflverse_pbp pbp
        join source.nflverse_participation participation
          on pbp.game_id = participation.game_id
          and pbp.play_id = participation.play_id
        where pbp.qb_dropback = 1
          and pbp.passer_player_id is not null
          and participation.was_pressure is not null
        group by pbp.season, pbp.passer_player_id`,
      `create or replace table model.nflverse_route_seasons as
        with dropback_participation as (
          select
            pbp.season,
            player.gsis_id::varchar as gsis_id,
            count(*)::double as dropback_participation
          from source.nflverse_pbp pbp
          join source.nflverse_participation participation
            on pbp.game_id = participation.game_id
            and pbp.play_id = participation.play_id
          cross join unnest(string_split(participation.offense_players, ';')) as player(gsis_id)
          where pbp.qb_dropback = 1
            and participation.offense_players is not null
          group by pbp.season, gsis_id
        ),
        charted_routes as (
          select
            pbp.season,
            pbp.receiver_player_id as gsis_id,
            count(*) filter (where participation.route <> '')::double as charted_route_targets,
            avg(
              case when participation.route in ('CORNER', 'DEEP OUT', 'GO', 'POST', 'WHEEL')
                then 1 else 0 end
            ) filter (where participation.route <> '')::double as deep_route_target_share,
            avg(
              case when participation.route = 'SCREEN' then 1 else 0 end
            ) filter (where participation.route <> '')::double as screen_route_target_share
          from source.nflverse_pbp pbp
          join source.nflverse_participation participation
            on pbp.game_id = participation.game_id
            and pbp.play_id = participation.play_id
          where pbp.receiver_player_id is not null
          group by pbp.season, pbp.receiver_player_id
        )
        select
          coalesce(dropbacks.season, routes.season) as season,
          coalesce(dropbacks.gsis_id, routes.gsis_id) as gsis_id,
          dropbacks.dropback_participation,
          routes.charted_route_targets,
          routes.deep_route_target_share,
          routes.screen_route_target_share
        from dropback_participation dropbacks
        full join charted_routes routes
          on dropbacks.season = routes.season
          and dropbacks.gsis_id = routes.gsis_id`,
      `create or replace table model.nflverse_goal_line_seasons as
        with opportunities as (
          select
            season,
            rusher_player_id as gsis_id,
            1::double as goal_line_carry,
            0::double as goal_line_target
          from source.nflverse_pbp
          where rush_attempt = 1
            and qb_kneel = 0
            and yardline_100 <= 5
            and rusher_player_id is not null
          union all
          select
            season,
            receiver_player_id as gsis_id,
            0::double as goal_line_carry,
            1::double as goal_line_target
          from source.nflverse_pbp
          where pass_attempt = 1
            and yardline_100 <= 5
            and receiver_player_id is not null
        )
        select
          season,
          gsis_id,
          sum(goal_line_carry)::double as goal_line_carries,
          sum(goal_line_target)::double as goal_line_targets
        from opportunities
        group by season, gsis_id`,
      `create or replace table model.nflverse_nextgen_passing_seasons as
        select
          season::integer as season,
          player_gsis_id::varchar as gsis_id,
          sum(attempts)::double as ngs_pass_attempts,
          sum(completion_percentage_above_expectation * attempts)
            / nullif(sum(attempts), 0) as completion_percentage_above_expectation,
          sum(avg_time_to_throw * attempts) / nullif(sum(attempts), 0) as avg_time_to_throw,
          sum(avg_intended_air_yards * attempts) / nullif(sum(attempts), 0)
            as avg_intended_air_yards
        from source.nflverse_nextgen_passing
        where season_type = 'REG'
          and week > 0
        group by season, player_gsis_id`,
      `create or replace table model.nflverse_nextgen_receiving_seasons as
        select
          season::integer as season,
          player_gsis_id::varchar as gsis_id,
          sum(targets)::double as ngs_targets,
          sum(avg_separation * targets) / nullif(sum(targets), 0) as avg_separation,
          sum(avg_yac_above_expectation * receptions) / nullif(sum(receptions), 0)
            as avg_yac_above_expectation,
          sum(percent_share_of_intended_air_yards * targets) / nullif(sum(targets), 0)
            as intended_air_yards_share
        from source.nflverse_nextgen_receiving
        where season_type = 'REG'
          and week > 0
        group by season, player_gsis_id`,
      `create or replace table model.nflverse_nextgen_rushing_seasons as
        select
          season::integer as season,
          player_gsis_id::varchar as gsis_id,
          sum(rush_attempts)::double as ngs_rush_attempts,
          sum(rush_yards_over_expected) / nullif(sum(rush_attempts), 0)
            as rush_yards_over_expected_per_attempt,
          sum(rush_pct_over_expected * rush_attempts) / nullif(sum(rush_attempts), 0)
            as rush_pct_over_expected
        from source.nflverse_nextgen_rushing
        where season_type = 'REG'
          and week > 0
        group by season, player_gsis_id`,
      `create or replace table model.ffopportunity_player_seasons as
        select
          season::integer as season,
          player_id::varchar as gsis_id,
          any_value(full_name)::varchar as player_name,
          any_value(position)::varchar as position,
          any_value(posteam)::varchar as team,
          count(distinct week)::integer as opportunity_games,
          sum(total_fantasy_points)::double as actual_opportunity_points,
          sum(total_fantasy_points_exp)::double as expected_fantasy_points,
          sum(pass_fantasy_points_exp)::double as expected_pass_points,
          sum(rec_fantasy_points_exp)::double as expected_rec_points,
          sum(rush_fantasy_points_exp)::double as expected_rush_points,
          sum(pass_attempt)::double as pass_attempts,
          sum(rec_attempt)::double as targets,
          sum(rush_attempt)::double as rush_attempts,
          sum(total_yards_gained_exp)::double as expected_total_yards,
          sum(total_touchdown_exp)::double as expected_total_tds
        from source.ffopportunity_weekly
        where position in ('QB', 'RB', 'WR', 'TE')
        group by season, player_id`,
      `create or replace table model.dynastyprocess_player_ids as
        select *
        from (
          select
            db_season::integer as season,
            sleeper_id::varchar as sleeper_player_id,
            gsis_id::varchar as gsis_id,
            fantasypros_id::varchar as fantasypros_id,
            espn_id::varchar as espn_id,
            name::varchar as player_name,
            merge_name::varchar as normalized_name,
            position::varchar as position,
            team::varchar as team,
            try_cast(age as double) as age,
            try_cast(draft_year as integer) as draft_year,
            try_cast(draft_round as integer) as draft_round,
            try_cast(draft_pick as integer) as draft_pick,
            row_number() over (
              partition by coalesce(sleeper_id, gsis_id, fantasypros_id), position
              order by db_season desc
            ) as row_number
          from source.dynastyprocess_player_ids
          where position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
        )
        where row_number = 1`,
      `create or replace table model.dynastyprocess_predraft_rankings as
        with source_cutoffs as (
          select
            extract(year from cast(r.scrape_date as date))::integer as season,
            coalesce(
              drafts.draft_timestamp,
              case
                when extract(year from cast(r.scrape_date as date)) = ${currentSeason}
                  then current_timestamp
                else (
                  select min(cast(s.gameday as date))::timestamptz
                  from source.nflverse_schedules s
                  where s.season = extract(year from cast(r.scrape_date as date))
                    and s.game_type = 'REG'
                )
              end
            ) as information_cutoff
          from source.dynastyprocess_rankings r
          left join model.historical_draft_dates drafts
            on extract(year from cast(r.scrape_date as date)) = drafts.season
          group by 1, 2
        ), eligible as (
          select
            extract(year from cast(r.scrape_date as date))::integer as season,
            r.id::varchar as fantasypros_id,
            ids.gsis_id,
            ids.sleeper_player_id,
            r.player::varchar as player_name,
            regexp_replace(lower(r.player), '[^a-z0-9]', '', 'g') as normalized_name,
            r.pos::varchar as position,
            coalesce(r.team, r.tm)::varchar as team,
            r.page_type::varchar as ranking_type,
            r.ecr::double as predraft_ecr,
            r.sd::double as predraft_rank_sd,
            r.best::double as predraft_best_rank,
            r.worst::double as predraft_worst_rank,
            cast(r.scrape_date as date) as scrape_date,
            (cast(r.scrape_date as date) + interval 1 day)::timestamptz
              as ranking_information_timestamp_upper_bound,
            cutoffs.information_cutoff as ranking_information_cutoff,
            row_number() over (
              partition by extract(year from cast(r.scrape_date as date)), r.id
              order by
                case when r.page_type = 'redraft-overall' then 0 else 1 end,
                cast(r.scrape_date as date) desc
            ) as recency_rank
          from source.dynastyprocess_rankings r
          join source_cutoffs cutoffs
            on extract(year from cast(r.scrape_date as date)) = cutoffs.season
          left join model.dynastyprocess_player_ids ids
            on r.id::varchar = ids.fantasypros_id
          where r.page_type in ('redraft-overall', 'best-overall')
            and r.pos in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
            and cast(r.scrape_date as date)
              between make_date(extract(year from cast(r.scrape_date as date))::integer, 5, 1)
              and make_date(extract(year from cast(r.scrape_date as date))::integer, 9, 10)
            and (cast(r.scrape_date as date) + interval 1 day)::timestamptz
              <= cutoffs.information_cutoff
        )
        select *
        from eligible
        where recency_rank = 1`,
      `create or replace table model.historical_prediction_base as
        select
          ps.season,
          coalesce(ids.sleeper_player_id, rankings.sleeper_player_id) as sleeper_player_id,
          ps.gsis_id,
          ps.player_name,
          ps.position,
          coalesce(snapshot.team, rankings.team) as team,
          ps.team as outcome_team,
          ids.age,
          ids.draft_year,
          ids.draft_round,
          ids.draft_pick,
          case when ids.draft_year = ps.season then true else false end as is_rookie,
          ps.games,
          ps.fantasy_points_ppr as actual_points,
          ps.fantasy_points_ppr
            + coalesce(ps.rush_attempts, 0) * ${RUSH_ATTEMPT_BONUS}
            + case
                when ps.position = 'TE' then coalesce(ps.receptions, 0) * ${TE_RECEPTION_BONUS}
                else 0
              end
            as current_league_actual_points,
          ps.fantasy_points_ppr / nullif(ps.games, 0) as actual_points_per_game,
          ps.fantasy_points_standard as actual_standard_points,
          ps.pass_attempts,
          ps.rush_attempts,
          ps.targets,
          ps.receptions,
          ps.passing_yards,
          ps.rushing_yards,
          ps.receiving_yards,
          ps.target_share,
          ps.air_yards_share,
          ps.wopr,
          snaps.offense_snaps,
          snaps.offense_snap_share,
          pressure.pressure_dropbacks,
          pressure.pressure_rate,
          pressure.pressure_time_to_throw,
          pressure.number_of_pass_rushers,
          routes.dropback_participation,
          routes.charted_route_targets,
          routes.deep_route_target_share,
          routes.screen_route_target_share,
          goal_line.goal_line_carries,
          goal_line.goal_line_targets,
          ngs_pass.completion_percentage_above_expectation,
          ngs_pass.avg_time_to_throw,
          ngs_pass.avg_intended_air_yards,
          ngs_rec.avg_separation,
          ngs_rec.avg_yac_above_expectation,
          ngs_rec.intended_air_yards_share,
          ngs_rush.rush_yards_over_expected_per_attempt,
          ngs_rush.rush_pct_over_expected,
          opp.expected_fantasy_points,
          opp.expected_fantasy_points / nullif(opp.opportunity_games, 0) as expected_points_per_game,
          opp.expected_pass_points,
          opp.expected_rec_points,
          opp.expected_rush_points,
          opp.expected_total_yards,
          opp.expected_total_tds,
          rankings.predraft_ecr,
          rankings.predraft_rank_sd,
          rankings.predraft_best_rank,
          rankings.predraft_worst_rank,
          rankings.ranking_type,
          rankings.ranking_information_timestamp_upper_bound,
          rankings.ranking_information_cutoff,
          snapshot.roster_status as asof_roster_status,
          snapshot.roster_information_timestamp as asof_roster_information_timestamp,
          snapshot.is_active as asof_is_active,
          snapshot.is_pup as asof_is_pup,
          snapshot.is_ir as asof_is_ir,
          snapshot.injury_primary as asof_injury_primary,
          snapshot.injury_secondary as asof_injury_secondary,
          snapshot.injury_designation as asof_injury_designation,
          snapshot.practice_status as asof_practice_status,
          snapshot.injury_information_timestamp as asof_injury_information_timestamp,
          snapshot.prior_season_games_played as asof_prior_season_games_played,
          snapshot.prior_season_team_games as asof_prior_season_team_games,
          snapshot.prior_season_missed_games as asof_prior_season_missed_games,
          snapshot.prior_season_availability_information_timestamp_upper_bound
            as asof_prior_season_availability_information_timestamp_upper_bound,
          snapshot.depth_position as asof_depth_position,
          snapshot.depth_rank as asof_depth_rank,
          snapshot.depth_information_timestamp as asof_depth_information_timestamp,
          snapshot.same_position_competitor_count as asof_same_position_competitor_count,
          snapshot.competition_information_timestamp_upper_bound
            as asof_competition_information_timestamp_upper_bound,
          snapshot.recent_trade_count as asof_recent_trade_count,
          snapshot.recent_transactions_coverage as asof_recent_transactions_coverage,
          snapshot.recent_transactions_complete as asof_recent_transactions_complete,
          snapshot.recent_transactions_information_timestamp_upper_bound
            as asof_recent_transactions_information_timestamp_upper_bound,
          snapshot.roster_status_missing_reason,
          snapshot.injury_missing_reason,
          snapshot.depth_chart_missing_reason,
          snapshot.max_information_timestamp as asof_max_information_timestamp,
          snapshot.cutoff_violation as asof_cutoff_violation,
          ts.pass_attempts as team_pass_attempts,
          ts.rush_attempts as team_rush_attempts,
          ts.passing_yards as team_passing_yards,
          ts.rushing_yards as team_rushing_yards,
          ts.passing_tds + ts.rushing_tds + ts.receiving_tds as team_offensive_tds,
          row_number() over (
            partition by ps.season, ps.position
            order by current_league_actual_points desc nulls last
          ) as actual_position_rank
        from model.nflverse_player_seasons ps
        left join model.dynastyprocess_player_ids ids
          on ps.gsis_id = ids.gsis_id
        left join model.ffopportunity_player_seasons opp
          on ps.gsis_id = opp.gsis_id
          and ps.season = opp.season
        left join model.dynastyprocess_predraft_rankings rankings
          on (
            ps.gsis_id = rankings.gsis_id
            or (ids.sleeper_player_id is not null and ids.sleeper_player_id = rankings.sleeper_player_id)
          )
          and ps.season = rankings.season
          and ps.position = rankings.position
        left join model.historical_asof_snapshots snapshot
          on ps.season = snapshot.season
          and ps.gsis_id = snapshot.gsis_id
          and ps.position = snapshot.position
        left join model.nflverse_team_seasons ts
          on ps.team = ts.team
          and ps.season = ts.season
        left join model.nflverse_snap_seasons snaps
          on ps.gsis_id = snaps.gsis_id
          and ps.season = snaps.season
        left join model.nflverse_pressure_seasons pressure
          on ps.gsis_id = pressure.gsis_id
          and ps.season = pressure.season
        left join model.nflverse_route_seasons routes
          on ps.gsis_id = routes.gsis_id
          and ps.season = routes.season
        left join model.nflverse_goal_line_seasons goal_line
          on ps.gsis_id = goal_line.gsis_id
          and ps.season = goal_line.season
        left join model.nflverse_nextgen_passing_seasons ngs_pass
          on ps.gsis_id = ngs_pass.gsis_id
          and ps.season = ngs_pass.season
        left join model.nflverse_nextgen_receiving_seasons ngs_rec
          on ps.gsis_id = ngs_rec.gsis_id
          and ps.season = ngs_rec.season
        left join model.nflverse_nextgen_rushing_seasons ngs_rush
          on ps.gsis_id = ngs_rush.gsis_id
          and ps.season = ngs_rush.season`,
      `create or replace table model.historical_replacement_points as
        select
          season,
          position,
          max(current_league_actual_points) filter (where actual_position_rank = ${REPLACEMENT_RANK_SQL}) as replacement_points
        from model.historical_prediction_base
        group by season, position`,
      `create or replace table model.prediction_training_dataset as
        select
          base.*,
          coalesce(base.current_league_actual_points, 0) - coalesce(repl.replacement_points, 0) as actual_value_over_replacement,
          base.actual_position_rank <= 12 as actual_top_12_position,
          base.actual_position_rank <= 24 as actual_top_24_position,
          base.actual_position_rank <= 36 as actual_top_36_position,
          avg(base.actual_points_per_game) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_points_per_game_3yr,
          avg(base.expected_points_per_game) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_expected_points_per_game_3yr,
          avg(base.pass_attempts / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_pass_attempts_per_game_3yr,
          avg(base.rush_attempts / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_rush_attempts_per_game_3yr,
          avg(base.targets / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_targets_per_game_3yr,
          case base.position
            when 'QB' then sum(base.pass_attempts) over (
              partition by base.gsis_id
              order by base.season
              rows between 3 preceding and 1 preceding
            )
            when 'RB' then sum(base.rush_attempts) over (
              partition by base.gsis_id
              order by base.season
              rows between 3 preceding and 1 preceding
            )
            when 'WR' then sum(base.targets) over (
              partition by base.gsis_id
              order by base.season
              rows between 3 preceding and 1 preceding
            )
            when 'TE' then sum(base.dropback_participation) over (
              partition by base.gsis_id
              order by base.season
              rows between 3 preceding and 1 preceding
            )
          end as trailing_player_volume_3yr,
          avg(base.receptions / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_receptions_per_game_3yr,
          avg(base.target_share) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_target_share_3yr,
          avg(base.air_yards_share) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_air_yards_share_3yr,
          avg(base.wopr) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_wopr_3yr,
          avg(base.offense_snap_share) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_offense_snap_share_3yr,
          avg(base.offense_snaps / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_offense_snaps_per_game_3yr,
          avg(base.pressure_rate) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_pressure_rate_3yr,
          avg(base.pressure_time_to_throw) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_pressure_time_to_throw_3yr,
          avg(base.number_of_pass_rushers) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_number_pass_rushers_3yr,
          avg(base.dropback_participation / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_dropback_participation_per_game_3yr,
          avg(base.charted_route_targets / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_charted_route_targets_per_game_3yr,
          avg(base.targets / nullif(base.dropback_participation, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_targets_per_dropback_participation_3yr,
          avg(base.deep_route_target_share) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_deep_route_target_share_3yr,
          avg(base.screen_route_target_share) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_screen_route_target_share_3yr,
          avg(base.goal_line_carries / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_goal_line_carries_per_game_3yr,
          avg(base.goal_line_targets / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_goal_line_targets_per_game_3yr,
          avg(base.completion_percentage_above_expectation) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_completion_percentage_above_expectation_3yr,
          avg(base.avg_time_to_throw) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_avg_time_to_throw_3yr,
          avg(base.avg_intended_air_yards) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_avg_intended_air_yards_3yr,
          avg(base.avg_separation) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_avg_separation_3yr,
          avg(base.avg_yac_above_expectation) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_avg_yac_above_expectation_3yr,
          avg(base.intended_air_yards_share) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_intended_air_yards_share_3yr,
          avg(base.rush_yards_over_expected_per_attempt) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_rush_yards_over_expected_per_attempt_3yr,
          avg(base.rush_pct_over_expected) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_rush_pct_over_expected_3yr,
          avg(base.expected_pass_points / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_expected_pass_points_per_game_3yr,
          avg(base.expected_rec_points / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_expected_rec_points_per_game_3yr,
          avg(base.expected_rush_points / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_expected_rush_points_per_game_3yr,
          avg(base.expected_total_tds / nullif(base.games, 0)) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_expected_tds_per_game_3yr,
          stddev_samp(base.actual_points_per_game) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_points_volatility_3yr,
          greatest(0, 17 - base.games) as missed_games,
          case
            when lag(base.games) over (
              partition by base.gsis_id
              order by base.season
            ) >= 8
              and lag(base.actual_points_per_game) over (
                partition by base.gsis_id
                order by base.season
              ) >= case when base.position = 'QB' then 8 else 5 end
              then greatest(0, 17 - base.games)
            else 0
          end as availability_eligible_missed_games,
          case
            when base.is_rookie then 'rookie_prior'
            when base.gsis_id is null then 'id_gap'
            when base.games < 6 then 'limited_games'
            else 'player_history'
          end as history_bucket,
          'nflverse: stats/snaps/NGS/rosters/schedules/team/player IDs; ffopportunity: expected points/opportunity; DynastyProcess: pre-draft rankings'::varchar
            as source_responsibility,
          now() as built_at
        from model.historical_prediction_base base
        left join model.historical_replacement_points repl
          on base.season = repl.season
          and base.position = repl.position`,
      `copy model.prediction_training_dataset
        to ${sqlString(MODEL_PATHS.trainingDatasetParquet)}
        (format parquet, compression zstd)`,
      `create or replace table model.current_prediction_features as
        with ids as (
          select *
          from (
            select
              *,
              row_number() over (
                partition by sleeper_player_id
                order by season desc
              ) as row_number
            from model.dynastyprocess_player_ids
            where sleeper_player_id is not null
          )
          where row_number = 1
        ),
        history as (
          select
            gsis_id,
            avg(actual_points_per_game) as trailing_points_per_game_3yr,
            avg(expected_points_per_game) as trailing_expected_points_per_game_3yr,
            stddev_samp(actual_points_per_game) as trailing_points_volatility_3yr,
            avg(actual_value_over_replacement) as trailing_value_over_replacement_3yr,
            avg(pass_attempts / nullif(games, 0)) as trailing_pass_attempts_per_game_3yr,
            avg(rush_attempts / nullif(games, 0)) as trailing_rush_attempts_per_game_3yr,
            avg(targets / nullif(games, 0)) as trailing_targets_per_game_3yr,
            sum(pass_attempts) as trailing_pass_attempts_3yr,
            sum(rush_attempts) as trailing_rush_attempts_3yr,
            sum(targets) as trailing_targets_3yr,
            sum(dropback_participation) as trailing_dropback_participation_3yr,
            avg(receptions / nullif(games, 0)) as trailing_receptions_per_game_3yr,
            avg(target_share) as trailing_target_share_3yr,
            avg(air_yards_share) as trailing_air_yards_share_3yr,
            avg(wopr) as trailing_wopr_3yr,
            avg(offense_snap_share) as trailing_offense_snap_share_3yr,
            avg(offense_snaps / nullif(games, 0)) as trailing_offense_snaps_per_game_3yr,
            avg(pressure_rate) as trailing_pressure_rate_3yr,
            avg(pressure_time_to_throw) as trailing_pressure_time_to_throw_3yr,
            avg(number_of_pass_rushers) as trailing_number_pass_rushers_3yr,
            avg(dropback_participation / nullif(games, 0))
              as trailing_dropback_participation_per_game_3yr,
            avg(charted_route_targets / nullif(games, 0))
              as trailing_charted_route_targets_per_game_3yr,
            avg(targets / nullif(dropback_participation, 0))
              as trailing_targets_per_dropback_participation_3yr,
            avg(deep_route_target_share) as trailing_deep_route_target_share_3yr,
            avg(screen_route_target_share) as trailing_screen_route_target_share_3yr,
            avg(goal_line_carries / nullif(games, 0))
              as trailing_goal_line_carries_per_game_3yr,
            avg(goal_line_targets / nullif(games, 0))
              as trailing_goal_line_targets_per_game_3yr,
            avg(completion_percentage_above_expectation)
              as trailing_completion_percentage_above_expectation_3yr,
            avg(avg_time_to_throw) as trailing_avg_time_to_throw_3yr,
            avg(avg_intended_air_yards) as trailing_avg_intended_air_yards_3yr,
            avg(avg_separation) as trailing_avg_separation_3yr,
            avg(avg_yac_above_expectation) as trailing_avg_yac_above_expectation_3yr,
            avg(intended_air_yards_share) as trailing_intended_air_yards_share_3yr,
            avg(rush_yards_over_expected_per_attempt)
              as trailing_rush_yards_over_expected_per_attempt_3yr,
            avg(rush_pct_over_expected) as trailing_rush_pct_over_expected_3yr,
            avg(expected_pass_points / nullif(games, 0))
              as trailing_expected_pass_points_per_game_3yr,
            avg(expected_rec_points / nullif(games, 0))
              as trailing_expected_rec_points_per_game_3yr,
            avg(expected_rush_points / nullif(games, 0))
              as trailing_expected_rush_points_per_game_3yr,
            avg(expected_total_tds / nullif(games, 0))
              as trailing_expected_tds_per_game_3yr,
            max(actual_points_per_game) as trailing_max_points_per_game_3yr,
            sum(
              case
                when season = ${currentSeason - 1} then availability_eligible_missed_games
                when season = ${currentSeason - 2} then availability_eligible_missed_games * 0.6
                when season = ${currentSeason - 3} then availability_eligible_missed_games * 0.3
                else 0
              end
            ) as trailing_weighted_availability_missed_games_3yr,
            count(*) as history_seasons
          from model.prediction_training_dataset
          where season between ${currentSeason - 3} and ${currentSeason - 1}
          group by gsis_id
        ),
        current_rankings as (
          select *
          from model.dynastyprocess_predraft_rankings
          where season = ${currentSeason}
        )
        select
          c.*,
          ids.gsis_id,
          ids.fantasypros_id,
          ids.draft_year,
          ids.draft_round,
          ids.draft_pick,
          history.trailing_points_per_game_3yr,
          history.trailing_expected_points_per_game_3yr,
          history.trailing_points_volatility_3yr,
          history.trailing_value_over_replacement_3yr,
          history.trailing_pass_attempts_per_game_3yr,
          history.trailing_rush_attempts_per_game_3yr,
          history.trailing_targets_per_game_3yr,
          case c.position
            when 'QB' then coalesce(history.trailing_pass_attempts_3yr, 0)
            when 'RB' then coalesce(history.trailing_rush_attempts_3yr, 0)
            when 'WR' then coalesce(history.trailing_targets_3yr, 0)
            when 'TE' then coalesce(history.trailing_dropback_participation_3yr, 0)
            else 0
          end as trailing_player_volume_3yr,
          history.trailing_receptions_per_game_3yr,
          history.trailing_target_share_3yr,
          history.trailing_air_yards_share_3yr,
          history.trailing_wopr_3yr,
          history.trailing_offense_snap_share_3yr,
          history.trailing_offense_snaps_per_game_3yr,
          history.trailing_pressure_rate_3yr,
          history.trailing_pressure_time_to_throw_3yr,
          history.trailing_number_pass_rushers_3yr,
          history.trailing_dropback_participation_per_game_3yr,
          history.trailing_charted_route_targets_per_game_3yr,
          history.trailing_targets_per_dropback_participation_3yr,
          history.trailing_deep_route_target_share_3yr,
          history.trailing_screen_route_target_share_3yr,
          history.trailing_goal_line_carries_per_game_3yr,
          history.trailing_goal_line_targets_per_game_3yr,
          history.trailing_completion_percentage_above_expectation_3yr,
          history.trailing_avg_time_to_throw_3yr,
          history.trailing_avg_intended_air_yards_3yr,
          history.trailing_avg_separation_3yr,
          history.trailing_avg_yac_above_expectation_3yr,
          history.trailing_intended_air_yards_share_3yr,
          history.trailing_rush_yards_over_expected_per_attempt_3yr,
          history.trailing_rush_pct_over_expected_3yr,
          history.trailing_expected_pass_points_per_game_3yr,
          history.trailing_expected_rec_points_per_game_3yr,
          history.trailing_expected_rush_points_per_game_3yr,
          history.trailing_expected_tds_per_game_3yr,
          history.trailing_max_points_per_game_3yr,
          coalesce(history.trailing_weighted_availability_missed_games_3yr, 0)
            as trailing_weighted_availability_missed_games_3yr,
          coalesce(history.history_seasons, 0) as history_seasons,
          current_rankings.predraft_ecr as dynastyprocess_current_ecr,
          current_rankings.predraft_rank_sd as dynastyprocess_current_rank_sd
        from model.current_player_join c
        left join ids
          on c.sleeper_player_id = ids.sleeper_player_id
        left join history
          on ids.gsis_id = history.gsis_id
        left join current_rankings
          on ids.gsis_id = current_rankings.gsis_id
          and c.position = current_rankings.position`,
    ]);

    const residualFeatureNames = [...new Set(OFFENSIVE_POSITIONS.flatMap(
      (position) => [...POSITION_FEATURES[position]]
    ))];
    const residualReader = await connection.runAndReadAll(`
      select * exclude (row_number, shared_projection),
        actual_points_per_game * 17 - shared_projection as target_residual
      from (
        select
          season,
          position,
          actual_points,
          actual_points_per_game,
          trailing_player_volume_3yr,
          ${residualFeatureNames.join(',\n          ')},
          coalesce(
            trailing_expected_points_per_game_3yr * 17,
            trailing_points_per_game_3yr * 17,
            greatest(0, 300 - predraft_ecr) * 0.72
          ) as shared_projection,
          row_number() over (
            partition by season, sleeper_player_id, position
            order by case when ranking_type = 'redraft-overall' then 0 else 1 end,
              predraft_ecr asc nulls last
          ) as row_number
        from model.prediction_training_dataset
        where position in ('QB', 'RB', 'WR', 'TE')
          and sleeper_player_id is not null
          and predraft_ecr is not null
          and predraft_ecr <= 250
          and actual_points is not null
          and actual_points_per_game is not null
      )
      where row_number = 1
        and shared_projection is not null
    `);
    const residualDbRows = residualReader.getRowObjects() as unknown as ResidualTrainingDbRow[];
    const residualRows: PositionResidualRow[] = residualDbRows.flatMap((row) => {
      if (!OFFENSIVE_POSITIONS.includes(row.position as OffensivePosition)) return [];
      const features = Object.fromEntries(residualFeatureNames.map((featureName) => {
        const value = row[featureName];
        return [featureName, value === null || value === undefined ? null : Number(value)];
      }));
      return [{
        season: Number(row.season),
        position: row.position as OffensivePosition,
        targetResidual: Number(row.target_residual),
        playerVolume: row.trailing_player_volume_3yr === null ||
            row.trailing_player_volume_3yr === undefined
          ? null
          : Number(row.trailing_player_volume_3yr),
        features,
      }];
    });
    const fittedPositionModels = fitAllPositionResidualModelsForSeason(
      residualRows,
      currentSeason
    );

    await runStatements(connection, [
      `create or replace table model.position_model_coefficients (
        position varchar,
        model_family varchar,
        candidate_set_version varchar,
        specification_id varchar,
        selection_validation_season integer,
        trained_through_season integer,
        ridge_lambda double,
        volume_threshold double,
        feature_name varchar,
        feature_mean double,
        feature_scale double,
        coefficient double,
        training_rows integer,
        target_residual_mean double,
        residual_cap double
      )`,
      `insert into model.position_model_coefficients values
        ${coefficientValuesSql(fittedPositionModels)}`,
    ]);

    await runStatements(connection, [
      `create or replace table model.shared_prediction_features as
        select
          current_features.*,
          greatest(
            0,
            coalesce(
              projected_points,
              trailing_expected_points_per_game_3yr * 17,
              trailing_points_per_game_3yr * 17,
              greatest(0, 300 - coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 300)) * 0.72
            )
          ) as shared_base_projected_points,
          coalesce(trailing_rush_attempts_per_game_3yr, 0) * 17 as projected_rush_attempts,
          coalesce(trailing_receptions_per_game_3yr, 0) * 17 as projected_receptions,
          least(1.0, coalesce(history_seasons, 0) / 3.0) as history_reliability
        from model.current_prediction_features current_features`,
      `create or replace table model.qb_prediction_features as
        select
          clipped.* exclude (centered_residual),
          centered_residual - avg(centered_residual) filter (
            where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
          ) over () as usage_efficiency_adjustment,
          ${sqlString(positionModelFamily(fittedPositionModels.QB))}::varchar as model_family
        from (
          select
            centered.* exclude (raw_residual),
            least(${fittedPositionModels.QB.residualCap}, greatest(-${fittedPositionModels.QB.residualCap},
              raw_residual - avg(raw_residual) filter (
                where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
              ) over ()
            )) as centered_residual
          from (
            select shared.*, ${residualExpression(fittedPositionModels.QB)} as raw_residual
            from model.shared_prediction_features shared
            where position = 'QB'
          ) centered
        ) clipped`,
      `create or replace table model.rb_prediction_features as
        select
          clipped.* exclude (centered_residual),
          centered_residual - avg(centered_residual) filter (
            where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
          ) over () as usage_efficiency_adjustment,
          ${sqlString(positionModelFamily(fittedPositionModels.RB))}::varchar as model_family
        from (
          select
            centered.* exclude (raw_residual),
            least(${fittedPositionModels.RB.residualCap}, greatest(-${fittedPositionModels.RB.residualCap},
              raw_residual - avg(raw_residual) filter (
                where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
              ) over ()
            )) as centered_residual
          from (
            select shared.*, ${residualExpression(fittedPositionModels.RB)} as raw_residual
            from model.shared_prediction_features shared
            where position = 'RB'
          ) centered
        ) clipped`,
      `create or replace table model.wr_prediction_features as
        select
          clipped.* exclude (centered_residual),
          centered_residual - avg(centered_residual) filter (
            where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
          ) over () as usage_efficiency_adjustment,
          ${sqlString(positionModelFamily(fittedPositionModels.WR))}::varchar as model_family
        from (
          select
            centered.* exclude (raw_residual),
            least(${fittedPositionModels.WR.residualCap}, greatest(-${fittedPositionModels.WR.residualCap},
              raw_residual - avg(raw_residual) filter (
                where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
              ) over ()
            )) as centered_residual
          from (
            select shared.*, ${residualExpression(fittedPositionModels.WR)} as raw_residual
            from model.shared_prediction_features shared
            where position = 'WR'
          ) centered
        ) clipped`,
      `create or replace table model.te_prediction_features as
        select
          clipped.* exclude (centered_residual),
          centered_residual - avg(centered_residual) filter (
            where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
          ) over () as usage_efficiency_adjustment,
          ${sqlString(positionModelFamily(fittedPositionModels.TE))}::varchar as model_family
        from (
          select
            centered.* exclude (raw_residual),
            least(${fittedPositionModels.TE.residualCap}, greatest(-${fittedPositionModels.TE.residualCap},
              raw_residual - avg(raw_residual) filter (
                where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
              ) over ()
            )) as centered_residual
          from (
            select shared.*, ${residualExpression(fittedPositionModels.TE)} as raw_residual
            from model.shared_prediction_features shared
            where position = 'TE'
          ) centered
        ) clipped`,
      `create or replace table model.special_teams_prediction_features as
        select
          shared.*,
          0::double as usage_efficiency_adjustment,
          'special-teams-baseline-v1'::varchar as model_family
        from model.shared_prediction_features shared
        where position in ('K', 'DEF')`,
      `create or replace table model.position_model_components as
        select * from model.qb_prediction_features
        union all by name select * from model.rb_prediction_features
        union all by name select * from model.wr_prediction_features
        union all by name select * from model.te_prediction_features
        union all by name select * from model.special_teams_prediction_features`,
      `create or replace table model.prediction_outputs as
        with risk_components as (
          select
            position_features.*,
            greatest(0, shared_base_projected_points + usage_efficiency_adjustment)
              as base_ppr_projected_points,
            case
              when lower(coalesce(news_status, status, '')) = 'out' then 9
              when lower(coalesce(news_status, status, '')) = 'questionable' then 6.5
              when lower(coalesce(news_status, status, '')) = 'limited' then 5
              when lower(coalesce(news_status, status, '')) like '%injured reserve%' then 9
              when lower(coalesce(news_status, status, '')) like '%pup%' then 8
              else 2
            end as current_status_risk,
            case
              when years_experience = 0 then 2
              when history_seasons = 0 then 2
              when coalesce(trailing_max_points_per_game_3yr, 0) <
                case when position = 'QB' then 8 else 5 end
                then 2
              else 2 + least(
                4,
                trailing_weighted_availability_missed_games_3yr / (17 * 1.9) * 14
              )
            end as historical_availability_risk
          from model.position_model_components position_features
        ),
        common_outputs as (
          select
            risk_components.*,
            projected_rush_attempts * ${RUSH_ATTEMPT_BONUS}
              + case
                  when position = 'TE' then projected_receptions * ${TE_RECEPTION_BONUS}
                  else 0
                end as custom_scoring_adjustment,
            base_ppr_projected_points
              + projected_rush_attempts * ${RUSH_ATTEMPT_BONUS}
              + case
                  when position = 'TE' then projected_receptions * ${TE_RECEPTION_BONUS}
                  else 0
                end as league_projected_points,
            least(10, greatest(1,
              2.5
              + case
                  when years_experience = 0 then 2.4
                  when years_experience <= 2 then 1.2
                  when history_seasons = 0 then 1.4
                  else 0
                end
              + coalesce(trailing_points_volatility_3yr, 0) / 6
              + coalesce(dynastyprocess_current_rank_sd, 0) / 18
            )) as model_uncertainty_score,
            least(10, greatest(1,
              greatest(current_status_risk, historical_availability_risk)
            )) as model_injury_risk_score
          from risk_components
        ),
        distributions as (
          select
            common_outputs.*,
            greatest(0, league_projected_points - (
              case position when 'QB' then 18 when 'RB' then 22
                when 'WR' then 20 when 'TE' then 17 else 12 end
              + model_uncertainty_score * 2.2
            )) as floor_projected_points,
            league_projected_points + (
              case position when 'QB' then 20 when 'RB' then 25
                when 'WR' then 23 when 'TE' then 20 else 14 end
              + model_uncertainty_score * 2.6
            ) as ceiling_projected_points
          from common_outputs
        ),
        ranked as (
          select
            distributions.*,
            row_number() over (
              partition by position order by league_projected_points desc, ecr_rank asc
            ) as projected_position_rank,
            (1 - percent_rank() over (
              partition by position order by league_projected_points desc
            )) * 100 as position_percentile
          from distributions
        ),
        replacement as (
          select
            position,
            max(league_projected_points) filter (
              where projected_position_rank = ${REPLACEMENT_RANK_SQL}
            ) as replacement_points
          from ranked
          group by position
        )
        select
          sleeper_player_id,
          player_name,
          position,
          team,
          base_ppr_projected_points as base_projected_points,
          usage_efficiency_adjustment,
          custom_scoring_adjustment,
          league_projected_points as projected_points,
          floor_projected_points,
          ceiling_projected_points,
          position_percentile,
          league_projected_points - coalesce(replacement.replacement_points, 0)
            as value_over_replacement,
          least(10, greatest(1,
            5
            + coalesce(trailing_value_over_replacement_3yr, 0) / 28
            + coalesce(offense_score, 5) / 5
            + case when years_experience = 0 then 0.7 else 0 end
          )) as ceiling_score,
          least(10, greatest(1,
            5
            + coalesce(trailing_value_over_replacement_3yr, 0) / 40
            - case when coalesce(news_status, status) in ('out', 'questionable', 'limited') then 1.4 else 0 end
            - coalesce(trailing_points_volatility_3yr, 0) / 8
          )) as floor_score,
          model_uncertainty_score as uncertainty_score,
          model_injury_risk_score as injury_risk_score,
          model_family
        from ranked current_features
        left join replacement
          using (position)
        where sleeper_player_id is not null`,
    ]);

    if (hasLeagueHistory) {
      await runStatements(connection, [
        `create or replace table model.league_history_picks as
          select
            s.season::integer as season,
            s.draftId::varchar as draft_id,
            s.leagueId::varchar as league_id,
            s.userSlot::integer as user_slot,
            s.userRosterId::integer as user_roster_id,
            s.scoringType::varchar as scoring_type,
            p.pickNo::integer as pick_no,
            p.round::integer as round,
            p.roundPick::integer as round_pick,
            p.draftSlot::integer as draft_slot,
            p.rosterId::integer as roster_id,
            p.playerId::varchar as sleeper_player_id,
            p.playerName::varchar as player_name,
            p.position::varchar as position,
            p.nflTeam::varchar as team,
            p.isUserPick::boolean as is_user_pick
          from (
            select unnest(seasons) as s
            from read_json_auto(${sqlString(MODEL_PATHS.leagueDraftHistoryJson)})
          ),
          lateral (
            select unnest(s.picks) as p
          )`,
        `create or replace table model.league_history_survival_training_dataset as
          select
            picks.*,
            rankings.predraft_ecr,
            rankings.predraft_rank_sd,
            rankings.ranking_type,
            rankings.scrape_date as ranking_snapshot_date,
            picks.pick_no as selected_at_pick,
            picks.pick_no - coalesce(rankings.predraft_ecr, picks.pick_no) as pick_vs_market,
            'Sleeper league draft history + DynastyProcess historical ranking context'::varchar
              as source_responsibility
          from model.league_history_picks picks
          left join model.dynastyprocess_predraft_rankings rankings
            on picks.sleeper_player_id = rankings.sleeper_player_id
            and picks.season = rankings.season
            and picks.position = rankings.position`,
      ]);
    } else {
      await runStatements(connection, [
        `create or replace table model.league_history_survival_training_dataset (
          season integer,
          draft_id varchar,
          league_id varchar,
          sleeper_player_id varchar,
          player_name varchar,
          position varchar,
          pick_no integer,
          predraft_ecr double,
          source_responsibility varchar
        )`,
      ]);
    }

    await runStatements(connection, [
      `create or replace table model.draft_pick_trade_grader_features as
        select
          outputs.sleeper_player_id,
          outputs.player_name,
          outputs.position,
          outputs.team,
          outputs.projected_points,
          outputs.floor_projected_points,
          outputs.ceiling_projected_points,
          outputs.position_percentile,
          outputs.value_over_replacement,
          outputs.ceiling_score,
          outputs.floor_score,
          outputs.uncertainty_score,
          outputs.injury_risk_score,
          outputs.model_family,
          current_features.ecr_rank as current_fantasypros_rank,
          current_features.sleeper_adp as current_sleeper_adp,
          current_features.sleeper_adp - current_features.ecr_rank as current_market_delta,
          least(0.95, greatest(0.05, 0.50 + (current_features.sleeper_adp - current_features.ecr_rank) / 50))
            as heuristic_next_pick_survival_probability,
          'prediction_outputs + survival model features + roster-aware recommendation inputs'::varchar
            as source_responsibility
        from model.prediction_outputs outputs
        join model.current_prediction_features current_features
          using (sleeper_player_id)`,
    ]);

    const predictionReader = await connection.runAndReadAll(`
      select
        sleeper_player_id as player_id,
        player_name,
        position,
        team,
        round(base_projected_points, 1) as base_projected_points,
        round(usage_efficiency_adjustment, 1) as usage_efficiency_adjustment,
        round(custom_scoring_adjustment, 1) as custom_scoring_adjustment,
        round(projected_points, 1) as projected_points,
        round(floor_projected_points, 1) as floor_projected_points,
        round(ceiling_projected_points, 1) as ceiling_projected_points,
        round(position_percentile, 1) as position_percentile,
        round(value_over_replacement, 1) as value_over_replacement,
        round(ceiling_score, 1) as ceiling_score,
        round(floor_score, 1) as floor_score,
        round(uncertainty_score, 1) as uncertainty_score,
        round(injury_risk_score, 1) as injury_risk_score,
        model_family
      from model.prediction_outputs
      order by projected_points desc
    `);

    const predictionRows = predictionReader.getRowObjects() as unknown as PredictionRow[];
    await writeFile(
      MODEL_PATHS.predictionsJson,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          modelVersion,
          sources: SOURCE_RESPONSIBILITIES,
          players: predictionRows.map((row) => ({
            playerId: String(row.player_id),
            name: row.player_name,
            position: row.position,
            team: row.team,
            baseProjectedPoints: asNumber(row.base_projected_points),
            usageEfficiencyAdjustment: asNumber(row.usage_efficiency_adjustment),
            customScoringAdjustment: asNumber(row.custom_scoring_adjustment),
            projectedPoints: asNumber(row.projected_points),
            customProjectedPoints: asNumber(row.projected_points),
            floorProjectedPoints: asNumber(row.floor_projected_points),
            ceilingProjectedPoints: asNumber(row.ceiling_projected_points),
            positionPercentile: asNumber(row.position_percentile),
            valueOverReplacement: asNumber(row.value_over_replacement),
            ceilingScore: asNumber(row.ceiling_score),
            floorScore: asNumber(row.floor_score),
            uncertaintyScore: asNumber(row.uncertainty_score),
            injuryRiskScore: asNumber(row.injury_risk_score),
            source: 'model',
            modelFamily: row.model_family,
            modelVersion,
          })),
        },
        null,
        2
      )}\n`
    );

    const countReader = await connection.runAndReadAll(`
      select 'source.nflverse_player_stats' as table_name, count(*) as row_count from source.nflverse_player_stats
      union all select 'source.nflverse_rosters', count(*) from source.nflverse_rosters
      union all select 'source.nflverse_schedules', count(*) from source.nflverse_schedules
      union all select 'source.nflverse_team_stats', count(*) from source.nflverse_team_stats
      union all select 'source.nflverse_player_ids', count(*) from source.nflverse_player_ids
      union all select 'source.nflverse_snap_counts', count(*) from source.nflverse_snap_counts
      union all select 'source.nflverse_participation', count(*) from source.nflverse_participation
      union all select 'source.nflverse_pbp', count(*) from source.nflverse_pbp
      union all select 'source.nflverse_nextgen_passing', count(*) from source.nflverse_nextgen_passing
      union all select 'source.nflverse_nextgen_receiving', count(*) from source.nflverse_nextgen_receiving
      union all select 'source.nflverse_nextgen_rushing', count(*) from source.nflverse_nextgen_rushing
      union all select 'source.ffopportunity_weekly', count(*) from source.ffopportunity_weekly
      union all select 'source.dynastyprocess_rankings', count(*) from source.dynastyprocess_rankings
      union all select 'source.dynastyprocess_player_ids', count(*) from source.dynastyprocess_player_ids
      union all select 'model.prediction_training_dataset', count(*) from model.prediction_training_dataset
      union all select 'model.position_model_coefficients', count(*) from model.position_model_coefficients
      union all select 'model.qb_prediction_features', count(*) from model.qb_prediction_features
      union all select 'model.rb_prediction_features', count(*) from model.rb_prediction_features
      union all select 'model.wr_prediction_features', count(*) from model.wr_prediction_features
      union all select 'model.te_prediction_features', count(*) from model.te_prediction_features
      union all select 'model.position_model_components', count(*) from model.position_model_components
      union all select 'model.prediction_outputs', count(*) from model.prediction_outputs
      union all select 'model.league_history_survival_training_dataset', count(*) from model.league_history_survival_training_dataset
      union all select 'model.draft_pick_trade_grader_features', count(*) from model.draft_pick_trade_grader_features
    `);
    const counts = (countReader.getRowObjects() as unknown as CountRow[]).map((row) => ({
      tableName: row.table_name,
      rowCount: Number(row.row_count),
    }));

    await writeFile(
      MODEL_PATHS.modelReportJson,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          modelVersion,
          seasons,
          currentSeason,
          responsibilities: SOURCE_RESPONSIBILITIES,
          artifacts: {
            trainingDatasetParquet: './data/model/training-dataset.parquet',
            predictionsJson: './data/predictions.json',
            leagueHistorySurvivalTable: 'model.league_history_survival_training_dataset',
            draftPickTradeGraderTable: 'model.draft_pick_trade_grader_features',
          },
          positionResidualModels: Object.fromEntries(
            OFFENSIVE_POSITIONS.map((position) => [position, {
              modelFamily: positionModelFamily(fittedPositionModels[position]),
              candidateSetVersion: fittedPositionModels[position].candidateSetVersion,
              specificationId: fittedPositionModels[position].specificationId,
              featureNames: fittedPositionModels[position].featureNames,
              volumeThreshold: fittedPositionModels[position].volumeThreshold,
              ridgeLambda: fittedPositionModels[position].lambda,
              selectedWithTrainingSeasons:
                fittedPositionModels[position].selectionTrainingSeasons,
              innerValidationSeason:
                fittedPositionModels[position].selectionValidationSeason,
              trainingRows: fittedPositionModels[position].trainingRows,
              trainedThroughSeason:
                fittedPositionModels[position].trainingSeasons.at(-1) ?? null,
            }])
          ),
          counts,
        },
        null,
        2
      )}\n`
    );

    await writeFile(
      `${BACKTESTS_MODEL_DIR}/source-responsibilities.json`,
      `${JSON.stringify(SOURCE_RESPONSIBILITIES, null, 2)}\n`
    );

    console.log(`Training dataset written to ${MODEL_PATHS.trainingDatasetParquet}`);
    console.log(`Prediction artifact written to ${MODEL_PATHS.predictionsJson}`);
    console.log(`Model report written to ${MODEL_PATHS.modelReportJson}`);
    console.log(JSON.stringify(counts, null, 2));
  } finally {
    connection.closeSync();
  }
}

main().catch((error: unknown) => {
  console.error('Prediction dataset build failed:', error);
  process.exit(1);
});
