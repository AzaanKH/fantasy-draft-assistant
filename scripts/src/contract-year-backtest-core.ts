export const OFFENSIVE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
export type OffensivePosition = (typeof OFFENSIVE_POSITIONS)[number];
export type ExpectedRole = 'high' | 'medium' | 'low' | 'rookie-unknown';

export interface HistoricalContract {
  readonly yearSigned: number;
  readonly contractEndYear: number;
}

export interface ContractState {
  readonly contractKnown: boolean;
  readonly isContractYear: boolean;
  readonly yearSigned: number | null;
  readonly contractEndYear: number | null;
  readonly exclusionReason: 'none' | 'no-prior-contract' | 'ambiguous-latest-contract';
}

export interface PlayerSeasonRow {
  readonly season: number;
  readonly gsisId: string;
  readonly playerName: string;
  readonly position: OffensivePosition;
  readonly actualPoints: number;
  readonly age: number | null;
  readonly experience: number;
  readonly priorPoints: number;
  readonly priorPointsPerGame3yr: number;
  readonly priorGames: number;
  readonly priorOpportunityPerGame: number;
  readonly priorTargetShare: number;
  readonly isRookie: boolean;
  readonly expectedRole: ExpectedRole;
  readonly contractKnown: boolean;
  readonly isContractYear: boolean;
}

export interface ModelPrediction extends PlayerSeasonRow {
  readonly predictedPoints: number;
}

export interface PredictionMetrics {
  readonly observations: number;
  readonly mae: number;
  readonly rmse: number;
  readonly vorMae: number;
  readonly top24Accuracy: number;
  readonly starterPoints: number;
  readonly draftRegret: number;
  readonly vorCaptured: number;
}

export interface SeasonComparison {
  readonly season: number;
  readonly baseline: PredictionMetrics;
  readonly contract: PredictionMetrics;
}

export interface ContractReleaseGate {
  readonly passed: boolean;
  readonly seasonsWithLowerMae: number;
  readonly seasonsRequired: number;
  readonly checks: {
    readonly minimumFiveTestSeasons: boolean;
    readonly minimumPlayerSeasonCoverage: boolean;
    readonly minimumContractYearCoverage: boolean;
    readonly allTestSeasonsPopulated: boolean;
    readonly aggregateMaeImproved: boolean;
    readonly aggregateRmseNonInferior: boolean;
    readonly aggregateVorMaeImproved: boolean;
    readonly aggregateVorCapturedNonInferior: boolean;
    readonly aggregateTop24NonInferior: boolean;
    readonly aggregateStarterPointsNonInferior: boolean;
    readonly aggregateDraftRegretNonInferior: boolean;
    readonly multipleSeasonsImproved: boolean;
  };
}

interface Standardizer {
  readonly means: readonly number[];
  readonly scales: readonly number[];
}

export const BASELINE_FEATURE_NAMES = [
  'position_rb',
  'position_wr',
  'position_te',
  'age',
  'age_squared',
  'age_missing',
  'experience',
  'prior_points',
  'prior_points_per_game_3yr',
  'prior_games',
  'prior_opportunity_per_game',
  'prior_target_share',
  'is_rookie',
  'role_high',
  'role_medium',
  'role_rookie_unknown',
] as const;

const REPLACEMENT_RANKS: Record<OffensivePosition, number> = {
  QB: 12,
  RB: 30,
  WR: 30,
  TE: 14,
};

const STARTER_COUNTS: Record<OffensivePosition, number> = {
  QB: 10,
  RB: 20,
  WR: 20,
  TE: 10,
};

function round(value: number, digits: number = 4): number {
  return Number(value.toFixed(digits));
}

export function reconstructContractState(
  season: number,
  contracts: readonly HistoricalContract[]
): ContractState {
  const priorContracts = contracts.filter(
    (contract) =>
      Number.isInteger(contract.yearSigned) &&
      Number.isInteger(contract.contractEndYear) &&
      contract.yearSigned < season
  );
  if (priorContracts.length === 0) {
    return {
      contractKnown: false,
      isContractYear: false,
      yearSigned: null,
      contractEndYear: null,
      exclusionReason: 'no-prior-contract',
    };
  }

  const latestYearSigned = Math.max(...priorContracts.map((contract) => contract.yearSigned));
  const latestContracts = priorContracts.filter(
    (contract) => contract.yearSigned === latestYearSigned
  );
  const endYears = [...new Set(latestContracts.map((contract) => contract.contractEndYear))];
  if (endYears.length !== 1) {
    return {
      contractKnown: false,
      isContractYear: false,
      yearSigned: latestYearSigned,
      contractEndYear: null,
      exclusionReason: 'ambiguous-latest-contract',
    };
  }

  const contractEndYear = endYears[0] ?? null;
  return {
    contractKnown: contractEndYear !== null,
    isContractYear: contractEndYear === season,
    yearSigned: latestYearSigned,
    contractEndYear,
    exclusionReason: 'none',
  };
}

function baselineFeatures(row: PlayerSeasonRow): number[] {
  const age = row.age ?? 0;
  return [
    row.position === 'RB' ? 1 : 0,
    row.position === 'WR' ? 1 : 0,
    row.position === 'TE' ? 1 : 0,
    age,
    age * age,
    row.age === null ? 1 : 0,
    row.experience,
    row.priorPoints,
    row.priorPointsPerGame3yr,
    row.priorGames,
    row.priorOpportunityPerGame,
    row.priorTargetShare,
    row.isRookie ? 1 : 0,
    row.expectedRole === 'high' ? 1 : 0,
    row.expectedRole === 'medium' ? 1 : 0,
    row.expectedRole === 'rookie-unknown' ? 1 : 0,
  ];
}

function rawFeatures(row: PlayerSeasonRow, includeContractYear: boolean): number[] {
  const features = baselineFeatures(row);
  if (includeContractYear) features.push(row.isContractYear ? 1 : 0);
  return features;
}

function createStandardizer(rows: readonly number[][]): Standardizer {
  const width = rows[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, column) =>
    rows.reduce((sum, row) => sum + (row[column] ?? 0), 0) / Math.max(1, rows.length)
  );
  const scales = means.map((mean, column) => {
    const variance = rows.reduce((sum, row) => {
      const difference = (row[column] ?? 0) - mean;
      return sum + difference * difference;
    }, 0) / Math.max(1, rows.length);
    const scale = Math.sqrt(variance);
    return scale > 1e-9 ? scale : 1;
  });
  return { means, scales };
}

function standardize(values: readonly number[], standardizer: Standardizer): number[] {
  return values.map(
    (value, index) =>
      (value - (standardizer.means[index] ?? 0)) / (standardizer.scales[index] ?? 1)
  );
}

function solveLinearSystem(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let bestRow = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[pivot] ?? 0) > Math.abs(augmented[bestRow]?.[pivot] ?? 0)) {
        bestRow = row;
      }
    }
    const pivotRow = augmented[pivot];
    const swapRow = augmented[bestRow];
    if (!pivotRow || !swapRow) continue;
    augmented[pivot] = swapRow;
    augmented[bestRow] = pivotRow;
    const divisor = augmented[pivot]?.[pivot] ?? 0;
    if (Math.abs(divisor) < 1e-12) continue;
    for (let column = pivot; column <= size; column += 1) {
      const activePivotRow = augmented[pivot];
      if (activePivotRow) activePivotRow[column] = (activePivotRow[column] ?? 0) / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row]?.[pivot] ?? 0;
      for (let column = pivot; column <= size; column += 1) {
        const activeRow = augmented[row];
        const pivotValue = augmented[pivot]?.[column] ?? 0;
        if (activeRow) activeRow[column] = (activeRow[column] ?? 0) - factor * pivotValue;
      }
    }
  }
  return augmented.map((row) => row[size] ?? 0);
}

export function fitRidgeModel(
  trainingRows: readonly PlayerSeasonRow[],
  includeContractYear: boolean,
  lambda: number = 10
): (row: PlayerSeasonRow) => number {
  if (trainingRows.length === 0) return () => 0;
  const rawTraining = trainingRows.map((row) => rawFeatures(row, includeContractYear));
  const standardizer = createStandardizer(rawTraining);
  const design = rawTraining.map((features) => [1, ...standardize(features, standardizer)]);
  const width = design[0]?.length ?? 0;
  const matrix = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const vector = Array.from({ length: width }, () => 0);

  for (let rowIndex = 0; rowIndex < design.length; rowIndex += 1) {
    const features = design[rowIndex];
    const target = trainingRows[rowIndex]?.actualPoints ?? 0;
    if (!features) continue;
    for (let left = 0; left < width; left += 1) {
      vector[left] = (vector[left] ?? 0) + (features[left] ?? 0) * target;
      for (let right = 0; right < width; right += 1) {
        const matrixRow = matrix[left];
        if (matrixRow) {
          matrixRow[right] = (matrixRow[right] ?? 0) +
            (features[left] ?? 0) * (features[right] ?? 0);
        }
      }
    }
  }
  for (let index = 1; index < width; index += 1) {
    const matrixRow = matrix[index];
    if (matrixRow) matrixRow[index] = (matrixRow[index] ?? 0) + lambda;
  }
  const coefficients = solveLinearSystem(matrix, vector);

  return (row: PlayerSeasonRow): number => {
    const features = [1, ...standardize(rawFeatures(row, includeContractYear), standardizer)];
    const prediction = features.reduce(
      (sum, feature, index) => sum + feature * (coefficients[index] ?? 0),
      0
    );
    return Math.max(0, prediction);
  };
}

function groupKey(row: PlayerSeasonRow): string {
  return `${String(row.season)}:${row.position}`;
}

function replacementValues(
  rows: readonly ModelPrediction[],
  value: (row: ModelPrediction) => number
): Map<string, number> {
  const grouped = new Map<string, ModelPrediction[]>();
  for (const row of rows) {
    const key = groupKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return new Map([...grouped.entries()].map(([key, values]) => {
    const sorted = [...values].sort((left, right) => value(right) - value(left));
    const position = values[0]?.position ?? 'QB';
    const replacement = sorted[REPLACEMENT_RANKS[position] - 1];
    return [key, replacement ? value(replacement) : 0];
  }));
}

function top24Accuracy(rows: readonly ModelPrediction[]): number {
  const grouped = new Map<string, ModelPrediction[]>();
  for (const row of rows) {
    const key = groupKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  let hits = 0;
  let possible = 0;
  for (const values of grouped.values()) {
    const actual = [...values].sort((a, b) => b.actualPoints - a.actualPoints).slice(0, 24);
    const predicted = new Set(
      [...values].sort((a, b) => b.predictedPoints - a.predictedPoints).slice(0, 24)
        .map((row) => row.gsisId)
    );
    hits += actual.filter((row) => predicted.has(row.gsisId)).length;
    possible += actual.length;
  }
  return hits / Math.max(1, possible);
}

function selectStarterPool(
  rows: readonly ModelPrediction[],
  value: (row: ModelPrediction) => number
): ModelPrediction[] {
  const selected: ModelPrediction[] = [];
  for (const position of OFFENSIVE_POSITIONS) {
    selected.push(
      ...rows.filter((row) => row.position === position)
        .sort((a, b) => value(b) - value(a))
        .slice(0, STARTER_COUNTS[position])
    );
  }
  const selectedIds = new Set(selected.map((row) => row.gsisId));
  selected.push(
    ...rows.filter(
      (row) => row.position !== 'QB' && !selectedIds.has(row.gsisId)
    ).sort((a, b) => value(b) - value(a)).slice(0, 20)
  );
  return selected;
}

export function evaluatePredictions(rows: readonly ModelPrediction[]): PredictionMetrics {
  if (rows.length === 0) {
    return {
      observations: 0,
      mae: 0,
      rmse: 0,
      vorMae: 0,
      top24Accuracy: 0,
      starterPoints: 0,
      draftRegret: 0,
      vorCaptured: 0,
    };
  }
  const actualReplacement = replacementValues(rows, (row) => row.actualPoints);
  const predictedReplacement = replacementValues(rows, (row) => row.predictedPoints);
  const absoluteErrors = rows.map((row) => Math.abs(row.predictedPoints - row.actualPoints));
  const squaredErrors = rows.map((row) => (row.predictedPoints - row.actualPoints) ** 2);
  const vorErrors = rows.map((row) => {
    const actualVor = row.actualPoints - (actualReplacement.get(groupKey(row)) ?? 0);
    const predictedVor = row.predictedPoints - (predictedReplacement.get(groupKey(row)) ?? 0);
    return Math.abs(predictedVor - actualVor);
  });

  let starterPoints = 0;
  let oracleStarterPoints = 0;
  let vorCaptured = 0;
  const seasons = [...new Set(rows.map((row) => row.season))];
  for (const season of seasons) {
    const seasonRows = rows.filter((row) => row.season === season);
    const selected = selectStarterPool(seasonRows, (row) => row.predictedPoints);
    const oracle = selectStarterPool(seasonRows, (row) => row.actualPoints);
    starterPoints += selected.reduce((sum, row) => sum + row.actualPoints, 0);
    oracleStarterPoints += oracle.reduce((sum, row) => sum + row.actualPoints, 0);
    vorCaptured += selected.reduce(
      (sum, row) => sum + row.actualPoints - (actualReplacement.get(groupKey(row)) ?? 0),
      0
    );
  }

  return {
    observations: rows.length,
    mae: round(absoluteErrors.reduce((sum, value) => sum + value, 0) / rows.length),
    rmse: round(Math.sqrt(squaredErrors.reduce((sum, value) => sum + value, 0) / rows.length)),
    vorMae: round(vorErrors.reduce((sum, value) => sum + value, 0) / rows.length),
    top24Accuracy: round(top24Accuracy(rows)),
    starterPoints: round(starterPoints, 2),
    draftRegret: round(Math.max(0, oracleStarterPoints - starterPoints), 2),
    vorCaptured: round(vorCaptured, 2),
  };
}

export function evaluateContractReleaseGate(
  aggregateBaseline: PredictionMetrics,
  aggregateContract: PredictionMetrics,
  seasons: readonly SeasonComparison[],
  contractYearObservations: number = 0
): ContractReleaseGate {
  const seasonsWithLowerMae = seasons.filter(
    (season) => season.contract.mae < season.baseline.mae
  ).length;
  const seasonsRequired = Math.max(3, Math.ceil(seasons.length * 0.6));
  const checks = {
    minimumFiveTestSeasons: seasons.length >= 5,
    minimumPlayerSeasonCoverage: aggregateBaseline.observations >= 1000,
    minimumContractYearCoverage: contractYearObservations >= 100,
    allTestSeasonsPopulated: seasons.every((season) => season.baseline.observations >= 200),
    aggregateMaeImproved: aggregateContract.mae < aggregateBaseline.mae,
    aggregateRmseNonInferior: aggregateContract.rmse <= aggregateBaseline.rmse,
    aggregateVorMaeImproved: aggregateContract.vorMae < aggregateBaseline.vorMae,
    aggregateVorCapturedNonInferior:
      aggregateContract.vorCaptured >= aggregateBaseline.vorCaptured,
    aggregateTop24NonInferior:
      aggregateContract.top24Accuracy >= aggregateBaseline.top24Accuracy,
    aggregateStarterPointsNonInferior:
      aggregateContract.starterPoints >= aggregateBaseline.starterPoints,
    aggregateDraftRegretNonInferior:
      aggregateContract.draftRegret <= aggregateBaseline.draftRegret,
    multipleSeasonsImproved: seasonsWithLowerMae >= seasonsRequired,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    seasonsWithLowerMae,
    seasonsRequired,
    checks,
  };
}

export function predictionBreakdown(
  baselineRows: readonly ModelPrediction[],
  contractRows: readonly ModelPrediction[],
  bucket: (row: ModelPrediction) => string
): Record<string, {
  readonly observations: number;
  readonly contractYearObservations: number;
  readonly baselineMae: number;
  readonly contractMae: number;
  readonly maeDelta: number;
}> {
  const labels = [...new Set(baselineRows.map(bucket))].sort();
  return Object.fromEntries(labels.map((label) => {
    const baseline = baselineRows.filter((row) => bucket(row) === label);
    const contract = contractRows.filter((row) => bucket(row) === label);
    const baselineMae = baseline.reduce(
      (sum, row) => sum + Math.abs(row.predictedPoints - row.actualPoints), 0
    ) / Math.max(1, baseline.length);
    const contractMae = contract.reduce(
      (sum, row) => sum + Math.abs(row.predictedPoints - row.actualPoints), 0
    ) / Math.max(1, contract.length);
    return [label, {
      observations: baseline.length,
      contractYearObservations: baseline.filter((row) => row.isContractYear).length,
      baselineMae: round(baselineMae),
      contractMae: round(contractMae),
      maeDelta: round(contractMae - baselineMae),
    }];
  }));
}

export function ageBucket(row: PlayerSeasonRow): string {
  if (row.age === null) return 'unknown';
  if (row.age < 25) return 'under-25';
  if (row.age < 29) return '25-28';
  return '29-plus';
}

export function experienceBucket(row: PlayerSeasonRow): string {
  if (row.experience === 0) return 'rookie';
  if (row.experience <= 3) return 'years-1-3';
  if (row.experience <= 7) return 'years-4-7';
  return 'years-8-plus';
}
