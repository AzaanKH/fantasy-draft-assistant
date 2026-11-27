import type { DuckDBConnection } from '@duckdb/node-api';
import { MODEL_PATHS, runStatements, sqlString } from '../model/duckdb.js';

/** League-history survival training rows (empty without imported history) and the trade-grader features. */
export async function buildLeagueHistoryTables(connection: DuckDBConnection, hasLeagueHistory: boolean): Promise<void> {
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
}
