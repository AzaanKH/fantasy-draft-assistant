/**
 * Three-season trailing features for one season, computed from earlier rows of the training dataset and keyed by
 * gsis_id. Live features and the prospective replay share it, so a draft-day row never depends on who is in the
 * current player pool.
 */
export function trailingHistorySql(currentSeason: number): string {
  return `
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
    group by gsis_id`;
}

/** The workload behind position shrinkage, chosen by the row's position from the trailing history. */
export function trailingPlayerVolumeSql(position: string, history: string): string {
  return `case ${position}
    when 'QB' then coalesce(${history}.trailing_pass_attempts_3yr, 0)
    when 'RB' then coalesce(${history}.trailing_rush_attempts_3yr, 0)
    when 'WR' then coalesce(${history}.trailing_targets_3yr, 0)
    when 'TE' then coalesce(${history}.trailing_dropback_participation_3yr, 0)
    else 0
  end`;
}
