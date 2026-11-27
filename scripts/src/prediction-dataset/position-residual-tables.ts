import type { DuckDBConnection } from '@duckdb/node-api';
import { OFFENSIVE_POSITIONS, sqlPositionList, type OffensivePosition } from '@fantasy-draft/shared/league';
import { EXCLUDES_FANTASYPROS, runStatements, sqlString } from '../model/duckdb.js';
import {
  POSITION_FEATURES,
  fitAllPositionResidualModelsForSeason,
  type FittedPositionResidualModel,
  type PositionResidualRow,
} from '../model/position-residual-model.js';
import { decodeResidualTrainingRows } from '../script-file-schemas.js';

export type FittedPositionResidualModels = Readonly<Record<OffensivePosition, FittedPositionResidualModel>>;

export function positionModelFamily(model: FittedPositionResidualModel): string {
  return `${model.position.toLowerCase()}-ridge-${model.specificationId}`;
}

function coefficientValuesSql(models: FittedPositionResidualModels): string {
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

/**
 * Training rows need a pre-draft relevance cut. The standard profile uses the
 * top 250 of DynastyProcess's FantasyPros ECR; the FantasyPros-free profile uses
 * the top 250 of the leakage-safe trailing projection instead.
 */
const TRAINING_RELEVANCE_FILTER = EXCLUDES_FANTASYPROS
  ? 'and trailing_relevance_rank <= 250'
  : `and predraft_ecr is not null
          and predraft_ecr <= 250`;

/** Fit each offensive position's residual model on the training dataset and store its coefficients. */
export async function fitAndStorePositionResidualModels(
  connection: DuckDBConnection,
  currentSeason: number
): Promise<FittedPositionResidualModels> {
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
        shared_projection,
        row_number() over (
          partition by season, sleeper_player_id, position
          order by case when ranking_type = 'redraft-overall' then 0 else 1 end,
            predraft_ecr asc nulls last
        ) as row_number
      from (
        select
          *,
          coalesce(
            trailing_expected_points_per_game_3yr * 17,
            trailing_points_per_game_3yr * 17,
            greatest(0, 300 - predraft_ecr) * 0.72
          ) as shared_projection,
          rank() over (
            partition by season
            order by coalesce(
              trailing_expected_points_per_game_3yr * 17,
              trailing_points_per_game_3yr * 17
            ) desc nulls last
          ) as trailing_relevance_rank
        from model.prediction_training_dataset
        where position in ${sqlPositionList(OFFENSIVE_POSITIONS)}
      )
      where sleeper_player_id is not null
        ${TRAINING_RELEVANCE_FILTER}
        and actual_points is not null
        and actual_points_per_game is not null
    )
    where row_number = 1
      and shared_projection is not null
  `);
  const residualDbRows = decodeResidualTrainingRows(residualReader.getRowObjects());
  const residualRows: PositionResidualRow[] = residualDbRows.flatMap((row) => {
    const features = Object.fromEntries(residualFeatureNames.map((featureName) => {
      const value = row[featureName];
      return [featureName, value === null || value === undefined ? null : Number(value)];
    }));
    return [{
      season: Number(row.season),
      position: row.position,
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
  return fittedPositionModels;
}
