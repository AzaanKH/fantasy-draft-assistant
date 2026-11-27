import { leagueScoringAdjustmentSql } from '@fantasy-draft/shared/league';
import { MODEL_PATHS, sqlString } from '../model/duckdb.js';

export const REPLACEMENT_RANK_SQL = `
  case position
    when 'QB' then 12
    when 'RB' then 30
    when 'WR' then 30
    when 'TE' then 14
    when 'K' then 12
    else 12
  end
`;
const CURRENT_LEAGUE_ACTUAL_BONUS = leagueScoringAdjustmentSql({
  position: 'ps.position',
  rushAttempts: 'coalesce(ps.rush_attempts, 0)',
  receptions: 'coalesce(ps.receptions, 0)',
});

/** The historical prediction base, the training dataset (also written to Parquet) and the current-season features. */
export function trainingTableStatements(currentSeason: number): string[] {
  return [
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
          + ${CURRENT_LEAGUE_ACTUAL_BONUS}
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
  ];
}
