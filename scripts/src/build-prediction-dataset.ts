/**
 * Builds the model-ready fantasy football datasets from historical sources.
 *
 * Source responsibilities:
 * - nflreadpy / nflverse: historical NFL stats, rosters, schedules, team stats, player IDs
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
  readonly projected_points: number | bigint;
  readonly value_over_replacement: number | bigint;
  readonly ceiling_score: number | bigint;
  readonly floor_score: number | bigint;
  readonly uncertainty_score: number | bigint;
  readonly injury_risk_score: number | bigint;
}

const SOURCE_RESPONSIBILITIES = {
  nflverse: [
    'historical NFL player stats',
    'historical rosters',
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
    'uses ffopportunity expected points/opportunity',
    'uses DynastyProcess pre-draft ranking context',
  ],
  rosterAwareRecommendation: [
    'uses prediction outputs',
    'uses current FantasyPros',
    'uses current Sleeper ADP',
    'uses team needs',
  ],
  leagueHistorySurvivalModel: [
    'uses imported Sleeper draft IDs',
    'uses historical pick outcomes',
    'uses current/historical ADP and ranking context',
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
  dynastyProcessRankings:
    'https://github.com/dynastyprocess/data/raw/master/files/db_fpecr.parquet',
  dynastyProcessPlayerIds:
    'https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv',
} as const;

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
  const hasLeagueHistory = await exists(MODEL_PATHS.leagueDraftHistoryJson);
  const connection = await connectModelDb();

  try {
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
              partition by db_season, coalesce(sleeper_id, gsis_id, fantasypros_id), position
              order by db_season desc
            ) as row_number
          from source.dynastyprocess_player_ids
          where position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
        )
        where row_number = 1`,
      `create or replace table model.dynastyprocess_predraft_rankings as
        select *
        from (
          select
            extract(year from cast(r.scrape_date as date))::integer as season,
            r.id::varchar as fantasypros_id,
            ids.gsis_id,
            ids.sleeper_player_id,
            r.player::varchar as player_name,
            lower(regexp_replace(r.player, '[^a-z0-9]', '', 'g')) as normalized_name,
            r.pos::varchar as position,
            coalesce(r.team, r.tm)::varchar as team,
            r.page_type::varchar as ranking_type,
            r.ecr::double as predraft_ecr,
            r.sd::double as predraft_rank_sd,
            r.best::double as predraft_best_rank,
            r.worst::double as predraft_worst_rank,
            cast(r.scrape_date as date) as scrape_date,
            row_number() over (
              partition by extract(year from cast(r.scrape_date as date)), r.id, r.page_type
              order by cast(r.scrape_date as date) desc
            ) as recency_rank
          from source.dynastyprocess_rankings r
          left join model.dynastyprocess_player_ids ids
            on r.id::varchar = ids.fantasypros_id
            and extract(year from cast(r.scrape_date as date))::integer = ids.season
          where r.page_type in ('redraft-overall', 'best-overall')
            and r.pos in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
            and cast(r.scrape_date as date)
              between make_date(extract(year from cast(r.scrape_date as date))::integer, 5, 1)
              and make_date(extract(year from cast(r.scrape_date as date))::integer, 9, 10)
        )
        where recency_rank = 1`,
      `create or replace table model.historical_prediction_base as
        select
          ps.season,
          coalesce(ids.sleeper_player_id, rankings.sleeper_player_id) as sleeper_player_id,
          ps.gsis_id,
          ps.player_name,
          ps.position,
          ps.team,
          ids.age,
          ids.draft_year,
          ids.draft_round,
          ids.draft_pick,
          case when ids.draft_year = ps.season then true else false end as is_rookie,
          ps.games,
          ps.fantasy_points_ppr as actual_points,
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
          ts.pass_attempts as team_pass_attempts,
          ts.rush_attempts as team_rush_attempts,
          ts.passing_yards as team_passing_yards,
          ts.rushing_yards as team_rushing_yards,
          ts.passing_tds + ts.rushing_tds + ts.receiving_tds as team_offensive_tds,
          row_number() over (
            partition by ps.season, ps.position
            order by ps.fantasy_points_ppr desc nulls last
          ) as actual_position_rank
        from model.nflverse_player_seasons ps
        left join model.dynastyprocess_player_ids ids
          on ps.gsis_id = ids.gsis_id
          and ps.season = ids.season
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
        left join model.nflverse_team_seasons ts
          on ps.team = ts.team
          and ps.season = ts.season`,
      `create or replace table model.historical_replacement_points as
        select
          season,
          position,
          max(actual_points) filter (where actual_position_rank = ${REPLACEMENT_RANK_SQL}) as replacement_points
        from model.historical_prediction_base
        group by season, position`,
      `create or replace table model.prediction_training_dataset as
        select
          base.*,
          coalesce(base.actual_points, 0) - coalesce(repl.replacement_points, 0) as actual_value_over_replacement,
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
          stddev_samp(base.actual_points_per_game) over (
            partition by base.gsis_id
            order by base.season
            rows between 3 preceding and 1 preceding
          ) as trailing_points_volatility_3yr,
          case
            when base.is_rookie then 'rookie_prior'
            when base.gsis_id is null then 'id_gap'
            when base.games < 6 then 'limited_games'
            else 'player_history'
          end as history_bucket,
          'nflverse: stats/rosters/schedules/team/player IDs; ffopportunity: expected points/opportunity; DynastyProcess: pre-draft rankings'::varchar
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
            count(*) as history_seasons
          from model.prediction_training_dataset
          where season between ${currentSeason - 3} and ${currentSeason - 1}
          group by gsis_id
        ),
        current_rankings as (
          select *
          from model.dynastyprocess_predraft_rankings
          where season = ${currentSeason}
            and ranking_type = 'redraft-overall'
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
      `create or replace table model.prediction_outputs as
        with replacement as (
          select
            position,
            avg(replacement_points) as replacement_points
          from model.historical_replacement_points
          group by position
        )
        select
          sleeper_player_id,
          player_name,
          position,
          team,
          greatest(
            0,
            coalesce(
              projected_points,
              trailing_expected_points_per_game_3yr * 17,
              trailing_points_per_game_3yr * 17,
              greatest(0, 300 - coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 300)) * 0.72
            )
          ) as projected_points,
          greatest(
            0,
            coalesce(
              projected_points,
              trailing_expected_points_per_game_3yr * 17,
              trailing_points_per_game_3yr * 17,
              greatest(0, 300 - coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 300)) * 0.72
            ) - coalesce(replacement.replacement_points, 0)
          ) as value_over_replacement,
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
          )) as uncertainty_score,
          least(10, greatest(1,
            case
              when coalesce(news_status, status) = 'out' then 9
              when coalesce(news_status, status) = 'questionable' then 6.5
              when coalesce(news_status, status) = 'limited' then 5
              when lower(coalesce(status, '')) like '%injured reserve%' then 9
              when lower(coalesce(status, '')) like '%pup%' then 8
              else 2
            end
          )) as injury_risk_score
        from model.current_prediction_features current_features
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
          outputs.value_over_replacement,
          outputs.ceiling_score,
          outputs.floor_score,
          outputs.uncertainty_score,
          outputs.injury_risk_score,
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
        round(projected_points, 1) as projected_points,
        round(value_over_replacement, 1) as value_over_replacement,
        round(ceiling_score, 1) as ceiling_score,
        round(floor_score, 1) as floor_score,
        round(uncertainty_score, 1) as uncertainty_score,
        round(injury_risk_score, 1) as injury_risk_score
      from model.prediction_outputs
      order by projected_points desc
    `);

    const predictionRows = predictionReader.getRowObjects() as unknown as PredictionRow[];
    await writeFile(
      MODEL_PATHS.predictionsJson,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          modelVersion: `historical-sources-v1-${seasons[0]}-${seasons[seasons.length - 1]}`,
          sources: SOURCE_RESPONSIBILITIES,
          players: predictionRows.map((row) => ({
            playerId: String(row.player_id),
            name: row.player_name,
            position: row.position,
            team: row.team,
            projectedPoints: asNumber(row.projected_points),
            valueOverReplacement: asNumber(row.value_over_replacement),
            ceilingScore: asNumber(row.ceiling_score),
            floorScore: asNumber(row.floor_score),
            uncertaintyScore: asNumber(row.uncertainty_score),
            injuryRiskScore: asNumber(row.injury_risk_score),
            source: 'model',
            modelVersion: `historical-sources-v1-${seasons[0]}-${seasons[seasons.length - 1]}`,
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
      union all select 'source.ffopportunity_weekly', count(*) from source.ffopportunity_weekly
      union all select 'source.dynastyprocess_rankings', count(*) from source.dynastyprocess_rankings
      union all select 'source.dynastyprocess_player_ids', count(*) from source.dynastyprocess_player_ids
      union all select 'model.prediction_training_dataset', count(*) from model.prediction_training_dataset
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
          seasons,
          currentSeason,
          responsibilities: SOURCE_RESPONSIBILITIES,
          artifacts: {
            trainingDatasetParquet: MODEL_PATHS.trainingDatasetParquet,
            predictionsJson: MODEL_PATHS.predictionsJson,
            leagueHistorySurvivalTable: 'model.league_history_survival_training_dataset',
            draftPickTradeGraderTable: 'model.draft_pick_trade_grader_features',
          },
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
