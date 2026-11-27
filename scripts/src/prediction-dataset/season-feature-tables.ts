import { OFFENSIVE_POSITIONS, POSITIONS, sqlPositionList } from '@fantasy-draft/shared/league';

/** Per-season player, team, usage, efficiency and ranking aggregates in the `model` schema. */
export function seasonFeatureTableStatements(currentSeason: number): string[] {
  return [
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
      where position in ${sqlPositionList([...OFFENSIVE_POSITIONS, 'K'])}`,
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
        and snaps.position in ${sqlPositionList(OFFENSIVE_POSITIONS)}
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
      where position in ${sqlPositionList(OFFENSIVE_POSITIONS)}
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
        where position in ${sqlPositionList(POSITIONS)}
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
          and r.pos in ${sqlPositionList(POSITIONS)}
          and cast(r.scrape_date as date)
            between make_date(extract(year from cast(r.scrape_date as date))::integer, 5, 1)
            and make_date(extract(year from cast(r.scrape_date as date))::integer, 9, 10)
          and (cast(r.scrape_date as date) + interval 1 day)::timestamptz
            <= cutoffs.information_cutoff
      )
      select *
      from eligible
      where recency_rank = 1`,
  ];
}
