/**
 * Builds the model-ready player dataset from the local DuckDB workspace.
 *
 * This first pass emits current-season feature rows with null historical labels.
 * Historical nflverse/ffopportunity extracts can extend the same table shape.
 *
 * Usage: pnpm --filter scripts model:dataset
 */

import {
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

async function main(): Promise<void> {
  const snapshot = await readJsonFile<FantasyProsSnapshot>(MODEL_PATHS.fantasyProsSnapshotJson);
  const season = snapshot.metadata?.season ?? new Date().getFullYear();
  const connection = await connectModelDb();

  try {
    await runStatements(connection, [
      `create schema if not exists model`,
      `create or replace table model.prediction_training_dataset as
        select
          ${season}::integer as season,
          'ppr'::varchar as scoring,
          sleeper_player_id,
          player_name,
          position,
          team,
          sleeper_adp,
          ecr_rank,
          positional_rank,
          best_rank,
          worst_rank,
          avg_rank,
          age,
          years_experience,
          case when years_experience = 0 then true else false end as is_rookie,
          missing_history_reason,
          case
            when years_experience = 0 then 0.85
            when years_experience <= 2 then 0.55
            when years_experience is null then 0.70
            else 0.15
          end as prior_weight,
          case
            when years_experience = 0 then 0.15
            when years_experience <= 2 then 0.45
            when years_experience is null then 0.30
            else 0.85
          end as player_history_weight,
          projected_points as current_expert_projected_points,
          floor_points as current_expert_floor_points,
          ceiling_points as current_expert_ceiling_points,
          offense_score,
          pass_volume,
          rush_volume,
          points_rank as team_points_rank,
          pass_attempts_rank as team_pass_attempts_rank,
          rush_attempts_rank as team_rush_attempts_rank,
          coaching_stability,
          is_contract_year,
          news_status,
          headline as news_headline,
          null::double as prior_year_points_per_game,
          null::double as prior_year_expected_points_per_game,
          null::double as weighted_points_per_game_3yr,
          null::double as weighted_xfp_per_game_3yr,
          null::double as actual_points,
          null::double as actual_points_per_game,
          null::double as actual_value_over_replacement,
          null::boolean as actual_top_12_position,
          null::boolean as actual_top_24_position,
          null::boolean as actual_top_36_position,
          now() as built_at
        from model.current_player_join
        where sleeper_player_id is not null`,
      `copy model.prediction_training_dataset
        to ${sqlString(MODEL_PATHS.trainingDatasetParquet)}
        (format parquet, compression zstd)`,
    ]);

    const reader = await connection.runAndReadAll(`
      select count(*) as row_count
      from model.prediction_training_dataset
    `);
    const row = reader.getRowObjects()[0] as { row_count: bigint } | undefined;
    console.log(
      `Training dataset written to ${MODEL_PATHS.trainingDatasetParquet} (${Number(row?.row_count ?? 0)} rows)`
    );
  } finally {
    connection.closeSync();
  }
}

main().catch((error: unknown) => {
  console.error('Prediction dataset build failed:', error);
  process.exit(1);
});
