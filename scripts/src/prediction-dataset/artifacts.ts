import { writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import { OFFENSIVE_POSITIONS } from '@fantasy-draft/shared/league';
import { BACKTESTS_MODEL_DIR, MODEL_PATHS, REPO_ROOT } from '../model/duckdb.js';
import { decodeDuckDbTableCounts, decodePredictionOutputRows } from '../script-file-schemas.js';
import { positionModelFamily, type FittedPositionResidualModels } from './position-residual-tables.js';
import { MODEL_SOURCES } from './source-responsibilities.js';

function asNumber(value: number | bigint): number {
  return Number(value);
}

interface PredictionArtifactInputs {
  readonly modelVersion: string;
  readonly seasons: readonly number[];
  readonly currentSeason: number;
  readonly fittedPositionModels: FittedPositionResidualModels;
}

/** Write the prediction artifact, the model report and the source responsibilities. */
export async function writePredictionArtifacts(
  connection: DuckDBConnection,
  { modelVersion, seasons, currentSeason, fittedPositionModels }: PredictionArtifactInputs
): Promise<void> {
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

  const predictionRows = decodePredictionOutputRows(predictionReader.getRowObjects());
  await writeFile(
    MODEL_PATHS.predictionsJson,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modelVersion,
        season: currentSeason,
        sources: MODEL_SOURCES,
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
  const counts = decodeDuckDbTableCounts(countReader.getRowObjects()).map((row) => ({
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
        responsibilities: MODEL_SOURCES,
        artifacts: {
          trainingDatasetParquet: `./${relative(REPO_ROOT, MODEL_PATHS.trainingDatasetParquet)}`,
          predictionsJson: `./${relative(REPO_ROOT, MODEL_PATHS.predictionsJson)}`,
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
    `${JSON.stringify(MODEL_SOURCES, null, 2)}\n`
  );

  console.log(`Training dataset written to ${MODEL_PATHS.trainingDatasetParquet}`);
  console.log(`Prediction artifact written to ${MODEL_PATHS.predictionsJson}`);
  console.log(`Model report written to ${MODEL_PATHS.modelReportJson}`);
  console.log(JSON.stringify(counts, null, 2));
}
