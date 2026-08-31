import { describe, expect, it } from 'vitest';
import {
  POSITION_MODEL_CANDIDATE_SET_VERSION,
  POSITION_MODEL_LAMBDA_CANDIDATES,
  POSITION_MODEL_SPECIFICATIONS,
  POSITION_MODEL_VOLUME_THRESHOLD_CANDIDATES,
  fitPositionResidualModel,
  fitPositionResidualModelForSeason,
  predictPositionResidual,
  shrinkMetricToPositionAverage,
  type PositionResidualRow,
} from './position-residual-model.js';

function row(
  season: number,
  feature: number,
  residual: number,
  playerVolume = 200
): PositionResidualRow {
  return {
    season,
    position: 'QB',
    targetResidual: residual,
    playerVolume,
    features: {
      trailing_pass_attempts_per_game_3yr: feature,
      trailing_completion_percentage_above_expectation_3yr: null,
      trailing_pressure_rate_3yr: null,
      trailing_pressure_time_to_throw_3yr: null,
      trailing_number_pass_rushers_3yr: null,
      trailing_avg_intended_air_yards_3yr: null,
      trailing_rush_attempts_per_game_3yr: null,
    },
  };
}

describe('position residual ridge model', () => {
  it('keeps the 2026 candidate set and thresholds in one versioned declaration', () => {
    expect(POSITION_MODEL_CANDIDATE_SET_VERSION).toBe('2026-predeclared-v1');
    expect(POSITION_MODEL_SPECIFICATIONS.map((specification) => specification.id)).toEqual([
      'workload-only-v1',
      'role-opportunity-v1',
      'expanded-efficiency-v1',
    ]);
    expect(POSITION_MODEL_LAMBDA_CANDIDATES).toEqual([1, 10, 100, 1_000, 10_000, 1_000_000_000]);
    expect(POSITION_MODEL_VOLUME_THRESHOLD_CANDIDATES.QB).toEqual([50, 100, 200, 400, 800]);
  });

  it('selects on the prior season, refits through it, and never reads the outer test season', () => {
    const priorRows = [
      ...Array.from({ length: 16 }, (_, index) => row(2021, index - 8, (index - 8) * 1.5)),
      ...Array.from({ length: 8 }, (_, index) => row(2022, index - 4, (index - 4) * 2)),
    ];
    const untouchedTestRows = Array.from(
      { length: 8 },
      (_, index) => row(2023, index, index * 10_000)
    );
    const first = fitPositionResidualModelForSeason(
      [...priorRows, ...untouchedTestRows],
      'QB',
      2023
    );
    const poisonedOuterRows = untouchedTestRows.map((testRow) => ({
      ...testRow,
      targetResidual: -testRow.targetResidual - 999_999,
      features: { ...testRow.features, trailing_pass_attempts_per_game_3yr: 999_999 },
    }));
    const second = fitPositionResidualModelForSeason(
      [...priorRows, ...poisonedOuterRows],
      'QB',
      2023
    );

    expect(first.selectionTrainingSeasons).toEqual([2021]);
    expect(first.selectionValidationSeason).toBe(2022);
    expect(first.trainingSeasons).toEqual([2021, 2022]);
    expect(first.specificationId).toBe(second.specificationId);
    expect(first.lambda).toBe(second.lambda);
    expect(first.volumeThreshold).toBe(second.volumeThreshold);
    expect(first.coefficients).toEqual(second.coefficients);
  });

  it('advances the inner validation cutoff one season for the next outer fold', () => {
    const rows = [
      ...Array.from({ length: 16 }, (_, index) => row(2021, index, index)),
      ...Array.from({ length: 8 }, (_, index) => row(2022, index, index * 2)),
      ...Array.from({ length: 8 }, (_, index) => row(2023, index, index * 3)),
      ...Array.from({ length: 8 }, (_, index) => row(2024, index, index * 4)),
    ];
    const model = fitPositionResidualModelForSeason(rows, 'QB', 2024);

    expect(model.selectionTrainingSeasons).toEqual([2021, 2022]);
    expect(model.selectionValidationSeason).toBe(2023);
    expect(model.trainingSeasons).toEqual([2021, 2022, 2023]);
  });

  it('learns a centered relationship instead of adding a fixed positive offset', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      row(2021 + Math.floor(index / 5), index - 10, (index - 10) * 2 + 12)
    );
    const model = fitPositionResidualModel(rows, 'QB');
    const lowRow = row(2025, -5, 0);
    const highRow = row(2025, 5, 0);
    const low = predictPositionResidual(model, lowRow.features, lowRow.playerVolume);
    const high = predictPositionResidual(model, highRow.features, highRow.playerVolume);
    const trainingMeanPrediction = rows.reduce(
      (sum, trainingRow) => sum + predictPositionResidual(
        model,
        trainingRow.features,
        trainingRow.playerVolume
      ),
      0
    ) / rows.length;

    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(0);
    expect(Math.abs(trainingMeanPrediction)).toBeLessThan(1e-8);
    expect(model.targetResidualMean).toBeGreaterThan(0);
  });

  it('imputes missing values to the training mean', () => {
    const rows = Array.from({ length: 16 }, (_, index) => row(2021 + index % 4, index, index));
    const model = fitPositionResidualModel(rows, 'QB');
    const prediction = predictPositionResidual(model, {}, null);

    expect(prediction).toBeCloseTo(0, 8);
  });

  it('shrinks observed metrics according to workload reliability', () => {
    expect(shrinkMetricToPositionAverage(10, 20, 2, 80)).toBeCloseTo(3.6, 8);
    expect(shrinkMetricToPositionAverage(10, 80, 2, 80)).toBeCloseTo(6, 8);
    expect(shrinkMetricToPositionAverage(10, 160, 2, 80)).toBeCloseTo(22 / 3, 8);
  });

  it('uses the positional baseline for missing history', () => {
    expect(shrinkMetricToPositionAverage(null, null, 4.25, 80)).toBe(4.25);
    expect(shrinkMetricToPositionAverage(99, 0, 4.25, 80)).toBe(4.25);
  });
});
