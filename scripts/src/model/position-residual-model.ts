export const OFFENSIVE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

export type OffensivePosition = (typeof OFFENSIVE_POSITIONS)[number];

export const POSITION_FEATURES = {
  QB: [
    'trailing_pass_attempts_per_game_3yr',
    'trailing_completion_percentage_above_expectation_3yr',
    'trailing_pressure_rate_3yr',
    'trailing_pressure_time_to_throw_3yr',
    'trailing_number_pass_rushers_3yr',
    'trailing_avg_intended_air_yards_3yr',
    'trailing_rush_attempts_per_game_3yr',
  ],
  RB: [
    'trailing_offense_snap_share_3yr',
    'trailing_rush_attempts_per_game_3yr',
    'trailing_targets_per_game_3yr',
    'trailing_goal_line_carries_per_game_3yr',
    'trailing_goal_line_targets_per_game_3yr',
    'trailing_expected_rush_points_per_game_3yr',
    'trailing_rush_yards_over_expected_per_attempt_3yr',
    'trailing_rush_pct_over_expected_3yr',
  ],
  WR: [
    'trailing_dropback_participation_per_game_3yr',
    'trailing_charted_route_targets_per_game_3yr',
    'trailing_targets_per_game_3yr',
    'trailing_target_share_3yr',
    'trailing_air_yards_share_3yr',
    'trailing_deep_route_target_share_3yr',
    'trailing_screen_route_target_share_3yr',
    'trailing_avg_separation_3yr',
    'trailing_avg_yac_above_expectation_3yr',
  ],
  TE: [
    'trailing_dropback_participation_per_game_3yr',
    'trailing_charted_route_targets_per_game_3yr',
    'trailing_targets_per_dropback_participation_3yr',
    'trailing_target_share_3yr',
    'trailing_offense_snap_share_3yr',
    'trailing_deep_route_target_share_3yr',
    'trailing_screen_route_target_share_3yr',
    'trailing_avg_separation_3yr',
    'trailing_avg_yac_above_expectation_3yr',
  ],
} as const satisfies Record<OffensivePosition, readonly string[]>;

export interface PositionResidualRow {
  readonly season: number;
  readonly position: OffensivePosition;
  readonly targetResidual: number;
  readonly playerVolume: number | null;
  readonly features: Readonly<Record<string, number | null>>;
}

export interface FittedPositionResidualModel {
  readonly position: OffensivePosition;
  readonly specificationId: PositionModelSpecificationId;
  readonly candidateSetVersion: string;
  readonly featureNames: readonly string[];
  readonly featureMeans: readonly number[];
  readonly featureScales: readonly number[];
  readonly coefficients: readonly number[];
  readonly lambda: number;
  readonly volumeThreshold: number;
  readonly residualCap: number;
  readonly targetResidualMean: number;
  readonly trainingRows: number;
  readonly trainingSeasons: readonly number[];
  readonly selectionTrainingSeasons: readonly number[];
  readonly selectionValidationSeason: number | null;
  readonly selectionValidationRows: number;
}

/**
 * This declaration is the model-selection protocol for the 2026 build. Changing
 * any candidate, feature list, or threshold requires a new version; historical
 * outer-fold results from an older version must not be used to tune the new set.
 */
export const POSITION_MODEL_CANDIDATE_SET_VERSION = '2026-predeclared-v1';

export const POSITION_MODEL_SPECIFICATIONS = [
  {
    id: 'workload-only-v1',
    features: {
      QB: ['trailing_pass_attempts_per_game_3yr', 'trailing_rush_attempts_per_game_3yr'],
      RB: ['trailing_offense_snap_share_3yr', 'trailing_rush_attempts_per_game_3yr',
        'trailing_targets_per_game_3yr'],
      WR: ['trailing_dropback_participation_per_game_3yr',
        'trailing_charted_route_targets_per_game_3yr', 'trailing_targets_per_game_3yr'],
      TE: ['trailing_dropback_participation_per_game_3yr',
        'trailing_charted_route_targets_per_game_3yr',
        'trailing_targets_per_dropback_participation_3yr'],
    },
  },
  {
    id: 'role-opportunity-v1',
    features: {
      QB: ['trailing_pass_attempts_per_game_3yr', 'trailing_avg_intended_air_yards_3yr',
        'trailing_rush_attempts_per_game_3yr'],
      RB: ['trailing_offense_snap_share_3yr', 'trailing_rush_attempts_per_game_3yr',
        'trailing_targets_per_game_3yr', 'trailing_goal_line_carries_per_game_3yr',
        'trailing_goal_line_targets_per_game_3yr',
        'trailing_expected_rush_points_per_game_3yr'],
      WR: ['trailing_dropback_participation_per_game_3yr',
        'trailing_charted_route_targets_per_game_3yr', 'trailing_targets_per_game_3yr',
        'trailing_target_share_3yr', 'trailing_air_yards_share_3yr'],
      TE: ['trailing_dropback_participation_per_game_3yr',
        'trailing_charted_route_targets_per_game_3yr',
        'trailing_targets_per_dropback_participation_3yr', 'trailing_target_share_3yr',
        'trailing_offense_snap_share_3yr'],
    },
  },
  {
    id: 'expanded-efficiency-v1',
    features: POSITION_FEATURES,
  },
] as const;

export type PositionModelSpecificationId =
  (typeof POSITION_MODEL_SPECIFICATIONS)[number]['id'];

export const POSITION_MODEL_LAMBDA_CANDIDATES = [
  1, 10, 100, 1_000, 10_000, 1_000_000_000,
] as const;
export const POSITION_MODEL_VOLUME_THRESHOLD_CANDIDATES:
Readonly<Record<OffensivePosition, readonly number[]>> = {
  QB: [50, 100, 200, 400, 800],
  RB: [20, 40, 80, 160, 320],
  WR: [20, 40, 80, 160, 320],
  TE: [50, 100, 200, 400, 800],
};
const DEFAULT_VOLUME_THRESHOLDS: Record<OffensivePosition, number> = {
  QB: 200,
  RB: 80,
  WR: 80,
  TE: 200,
};
export const MIN_TRAINING_ROWS = 12;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * probability)));
  return sorted[index] ?? 0;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index] ?? 0]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    const pivotRow = augmented[pivot];
    const columnRow = augmented[column];
    if (!pivotRow || !columnRow) continue;
    if (pivot !== column) {
      augmented[pivot] = columnRow;
      augmented[column] = pivotRow;
    }
    const diagonal = augmented[column]?.[column] ?? 0;
    if (Math.abs(diagonal) < 1e-10) continue;
    for (let entry = column; entry <= size; entry += 1) {
      const row = augmented[column];
      if (row) row[entry] = (row[entry] ?? 0) / diagonal;
    }
    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === column) continue;
      const row = augmented[rowIndex];
      const normalizedPivot = augmented[column];
      if (!row || !normalizedPivot) continue;
      const factor = row[column] ?? 0;
      for (let entry = column; entry <= size; entry += 1) {
        row[entry] = (row[entry] ?? 0) - factor * (normalizedPivot[entry] ?? 0);
      }
    }
  }

  return augmented.map((row, index) => row[size] ?? (index === size ? 1 : 0));
}

export function shrinkMetricToPositionAverage(
  playerMetric: number | null | undefined,
  playerVolume: number | null | undefined,
  positionAverage: number,
  positionThreshold: number
): number {
  if (playerMetric === null || playerMetric === undefined || !Number.isFinite(playerMetric)) {
    return positionAverage;
  }
  const volume = playerVolume === null || playerVolume === undefined || !Number.isFinite(playerVolume)
    ? 0
    : Math.max(0, playerVolume);
  const threshold = Math.max(0, positionThreshold);
  const reliability = threshold === 0 ? 1 : volume / (volume + threshold);
  return reliability * playerMetric + (1 - reliability) * positionAverage;
}

function fitWithHyperparameters(
  rows: readonly PositionResidualRow[],
  position: OffensivePosition,
  specificationId: PositionModelSpecificationId,
  featureNames: readonly string[],
  lambda: number,
  volumeThreshold: number,
  selection: {
    readonly trainingSeasons: readonly number[];
    readonly validationSeason: number | null;
    readonly validationRows: number;
  }
): FittedPositionResidualModel {
  if (rows.length < MIN_TRAINING_ROWS) {
    throw new Error(
      `Cannot fit ${position} position model ${specificationId}: ` +
      `${String(rows.length)} training rows; minimum ${String(MIN_TRAINING_ROWS)}.`
    );
  }
  const featureMeans = featureNames.map((featureName) => {
    const observed = rows
      .map((row) => row.features[featureName])
      .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
    return mean(observed);
  });
  const adjustedRows = rows.map((row) => featureNames.map((featureName, featureIndex) =>
    shrinkMetricToPositionAverage(
      row.features[featureName],
      row.playerVolume,
      featureMeans[featureIndex] ?? 0,
      volumeThreshold
    )
  ));
  const featureScales = featureNames.map((_featureName, featureIndex) => {
    const featureMean = featureMeans[featureIndex] ?? 0;
    const variance = mean(adjustedRows.map((row) => ((row[featureIndex] ?? featureMean) - featureMean) ** 2));
    const scale = Math.sqrt(variance);
    return scale > 1e-8 ? scale : 1;
  });
  const targetResidualMean = mean(rows.map((row) => row.targetResidual));
  const centeredTargets = rows.map((row) => row.targetResidual - targetResidualMean);
  const standardizedRows = adjustedRows.map((row) => row.map((value, featureIndex) => {
    const featureMean = featureMeans[featureIndex] ?? 0;
    const featureScale = featureScales[featureIndex] ?? 1;
    return (value - featureMean) / featureScale;
  }));
  const featureCount = featureNames.length;
  const gram = Array.from({ length: featureCount }, (_, rowIndex) =>
    Array.from({ length: featureCount }, (_, columnIndex) =>
      standardizedRows.reduce(
        (sum, row) => sum + (row[rowIndex] ?? 0) * (row[columnIndex] ?? 0),
        rowIndex === columnIndex ? lambda : 0
      )
    )
  );
  const crossProduct = Array.from({ length: featureCount }, (_, featureIndex) =>
    standardizedRows.reduce(
      (sum, row, rowIndex) => sum + (row[featureIndex] ?? 0) * (centeredTargets[rowIndex] ?? 0),
      0
    )
  );
  const coefficients = solveLinearSystem(gram, crossProduct);
  const centeredAbsoluteResiduals = centeredTargets.map((value) => Math.abs(value));

  return {
    position,
    specificationId,
    candidateSetVersion: POSITION_MODEL_CANDIDATE_SET_VERSION,
    featureNames,
    featureMeans,
    featureScales,
    coefficients,
    lambda,
    volumeThreshold,
    residualCap: Math.min(30, Math.max(8, quantile(centeredAbsoluteResiduals, 0.9))),
    targetResidualMean,
    trainingRows: rows.length,
    trainingSeasons: [...new Set(rows.map((row) => row.season))].sort((a, b) => a - b),
    selectionTrainingSeasons: selection.trainingSeasons,
    selectionValidationSeason: selection.validationSeason,
    selectionValidationRows: selection.validationRows,
  };
}

export function predictPositionResidual(
  model: FittedPositionResidualModel,
  features: Readonly<Record<string, number | null>>,
  playerVolume: number | null
): number {
  const prediction = model.featureNames.reduce((sum, featureName, featureIndex) => {
    const featureMean = model.featureMeans[featureIndex] ?? 0;
    const featureScale = model.featureScales[featureIndex] ?? 1;
    const value = shrinkMetricToPositionAverage(
      features[featureName],
      playerVolume,
      featureMean,
      model.volumeThreshold
    );
    return sum + ((value - featureMean) / featureScale) * (model.coefficients[featureIndex] ?? 0);
  }, 0);
  return Math.max(-model.residualCap, Math.min(model.residualCap, prediction));
}

interface SelectedHyperparameters {
  readonly specificationId: PositionModelSpecificationId;
  readonly featureNames: readonly string[];
  readonly lambda: number;
  readonly volumeThreshold: number;
  readonly trainingSeasons: readonly number[];
  readonly validationSeason: number | null;
  readonly validationRows: number;
}

function selectHyperparameters(
  rows: readonly PositionResidualRow[],
  position: OffensivePosition
): SelectedHyperparameters {
  const seasons = [...new Set(rows.map((row) => row.season))].sort((a, b) => a - b);
  const validationSeason = seasons.at(-1) ?? null;
  const trainingRows = validationSeason === null
    ? []
    : rows.filter((row) => row.season < validationSeason);
  const validationRows = validationSeason === null
    ? []
    : rows.filter((row) => row.season === validationSeason);
  const trainingSeasons = seasons.filter((season) => season !== validationSeason);
  const candidates = POSITION_MODEL_SPECIFICATIONS.flatMap((specification) =>
    POSITION_MODEL_VOLUME_THRESHOLD_CANDIDATES[position].flatMap((volumeThreshold) =>
      POSITION_MODEL_LAMBDA_CANDIDATES.map((lambda) => ({
        specificationId: specification.id,
        featureNames: specification.features[position] as readonly string[],
        lambda,
        volumeThreshold,
      }))
    )
  );
  const candidateErrors = new Map<string, number>();
  const keyFor = (candidate: SelectedHyperparameters): string =>
    `${candidate.specificationId}|${String(candidate.lambda)}|${String(candidate.volumeThreshold)}`;

  if (trainingRows.length >= MIN_TRAINING_ROWS && validationRows.length > 0) {
    for (const candidate of candidates) {
      const model = fitWithHyperparameters(
        trainingRows,
        position,
        candidate.specificationId,
        candidate.featureNames,
        candidate.lambda,
        candidate.volumeThreshold,
        { trainingSeasons, validationSeason: null, validationRows: 0 }
      );
      const predictions = validationRows.map((row) =>
        predictPositionResidual(model, row.features, row.playerVolume)
      );
      const predictionCenter = mean(predictions);
      const targetCenter = mean(validationRows.map((row) => row.targetResidual));
      const mae = mean(validationRows.map((row, index) =>
        Math.abs(
          (predictions[index] ?? 0) - predictionCenter - (row.targetResidual - targetCenter)
        )
      ));
      candidateErrors.set(keyFor({
        ...candidate,
        trainingSeasons,
        validationSeason,
        validationRows: validationRows.length,
      }), mae);
    }
  }

  const selected = candidates.sort((left, right) => {
    const leftError = candidateErrors.get(keyFor({
      ...left, trainingSeasons, validationSeason, validationRows: validationRows.length,
    })) ?? Number.POSITIVE_INFINITY;
    const rightError = candidateErrors.get(keyFor({
      ...right, trainingSeasons, validationSeason, validationRows: validationRows.length,
    })) ?? Number.POSITIVE_INFINITY;
    return leftError - rightError || right.lambda - left.lambda ||
      Math.abs(left.volumeThreshold - DEFAULT_VOLUME_THRESHOLDS[position]) -
        Math.abs(right.volumeThreshold - DEFAULT_VOLUME_THRESHOLDS[position]) ||
      left.specificationId.localeCompare(right.specificationId);
  })[0];
  const fallback = POSITION_MODEL_SPECIFICATIONS.find(
    (specification) => specification.id === 'expanded-efficiency-v1'
  ) ?? POSITION_MODEL_SPECIFICATIONS[0];
  const choice = candidateErrors.size > 0 && selected
    ? selected
    : {
        specificationId: fallback.id,
        featureNames: fallback.features[position] as readonly string[],
        lambda: 100,
        volumeThreshold: DEFAULT_VOLUME_THRESHOLDS[position],
      };
  return {
    ...choice,
    trainingSeasons,
    validationSeason,
    validationRows: validationRows.length,
  };
}

export function fitPositionResidualModel(
  allRows: readonly PositionResidualRow[],
  position: OffensivePosition
): FittedPositionResidualModel {
  const rows = allRows.filter((row) => row.position === position);
  const selected = selectHyperparameters(rows, position);
  return fitWithHyperparameters(
    rows,
    position,
    selected.specificationId,
    selected.featureNames,
    selected.lambda,
    selected.volumeThreshold,
    {
      trainingSeasons: selected.trainingSeasons,
      validationSeason: selected.validationSeason,
      validationRows: selected.validationRows,
    }
  );
}

export function fitPositionResidualModelForSeason(
  allRows: readonly PositionResidualRow[],
  position: OffensivePosition,
  predictionSeason: number
): FittedPositionResidualModel {
  return fitPositionResidualModel(
    allRows.filter((row) => row.season < predictionSeason),
    position
  );
}

export function fitAllPositionResidualModels(
  rows: readonly PositionResidualRow[]
): Readonly<Record<OffensivePosition, FittedPositionResidualModel>> {
  return {
    QB: fitPositionResidualModel(rows, 'QB'),
    RB: fitPositionResidualModel(rows, 'RB'),
    WR: fitPositionResidualModel(rows, 'WR'),
    TE: fitPositionResidualModel(rows, 'TE'),
  };
}

export function fitAllPositionResidualModelsForSeason(
  rows: readonly PositionResidualRow[],
  predictionSeason: number
): Readonly<Record<OffensivePosition, FittedPositionResidualModel>> {
  return {
    QB: fitPositionResidualModelForSeason(rows, 'QB', predictionSeason),
    RB: fitPositionResidualModelForSeason(rows, 'RB', predictionSeason),
    WR: fitPositionResidualModelForSeason(rows, 'WR', predictionSeason),
    TE: fitPositionResidualModelForSeason(rows, 'TE', predictionSeason),
  };
}
