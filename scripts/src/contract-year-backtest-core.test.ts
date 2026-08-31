import { describe, expect, it } from 'vitest';
import {
  evaluateContractReleaseGate,
  fitRidgeModel,
  reconstructContractState,
  type PlayerSeasonRow,
  type PredictionMetrics,
  type SeasonComparison,
} from './contract-year-backtest-core.js';

function row(season: number, isContractYear: boolean, actualPoints: number): PlayerSeasonRow {
  return {
    season,
    gsisId: `${String(season)}-${String(isContractYear)}`,
    playerName: 'Test Player',
    position: 'WR',
    actualPoints,
    age: 27,
    experience: 4,
    priorPoints: 100,
    priorPointsPerGame3yr: 7,
    priorGames: 16,
    priorOpportunityPerGame: 8,
    priorTargetShare: 0.15,
    isRookie: false,
    expectedRole: 'medium',
    contractKnown: true,
    isContractYear,
  };
}

function metrics(mae: number): PredictionMetrics {
  return {
    observations: 100,
    mae,
    rmse: mae + 10,
    vorMae: mae,
    top24Accuracy: 0.6,
    starterPoints: 1000,
    draftRegret: 100,
    vorCaptured: 500,
  };
}

describe('contract-year reconstruction', () => {
  it('uses the latest deal signed before the season', () => {
    expect(reconstructContractState(2024, [
      { yearSigned: 2020, contractEndYear: 2024 },
      { yearSigned: 2023, contractEndYear: 2027 },
    ])).toMatchObject({
      contractKnown: true,
      isContractYear: false,
      yearSigned: 2023,
      contractEndYear: 2027,
    });
  });

  it('excludes an extension signed during the evaluated season', () => {
    expect(reconstructContractState(2024, [
      { yearSigned: 2020, contractEndYear: 2024 },
      { yearSigned: 2024, contractEndYear: 2028 },
    ])).toMatchObject({
      contractKnown: true,
      isContractYear: true,
      yearSigned: 2020,
      contractEndYear: 2024,
    });
  });

  it('does not guess when latest same-year records have conflicting end years', () => {
    expect(reconstructContractState(2024, [
      { yearSigned: 2021, contractEndYear: 2024 },
      { yearSigned: 2021, contractEndYear: 2025 },
    ])).toEqual({
      contractKnown: false,
      isContractYear: false,
      yearSigned: 2021,
      contractEndYear: null,
      exclusionReason: 'ambiguous-latest-contract',
    });
  });
});

describe('contract-year model ablation', () => {
  it('adds predictive information only to the treatment model', () => {
    const training = Array.from({ length: 40 }, (_, index) =>
      row(2012 + Math.floor(index / 4), index % 2 === 0, index % 2 === 0 ? 150 : 100)
    );
    const baseline = fitRidgeModel(training, false, 0.01);
    const treatment = fitRidgeModel(training, true, 0.01);

    expect(Math.abs(baseline(row(2025, true, 0)) - baseline(row(2025, false, 0))))
      .toBeLessThan(0.0001);
    expect(treatment(row(2025, true, 0))).toBeGreaterThan(treatment(row(2025, false, 0)) + 40);
  });

  it('requires improvement across multiple future seasons', () => {
    const baseline = metrics(50);
    const contract = { ...metrics(49), starterPoints: 1001, draftRegret: 99 };
    const seasons: SeasonComparison[] = Array.from({ length: 5 }, (_, index) => ({
      season: 2020 + index,
      baseline,
      contract: metrics(index < 2 ? 49 : 51),
    }));

    const gate = evaluateContractReleaseGate(baseline, contract, seasons);
    expect(gate.seasonsRequired).toBe(3);
    expect(gate.seasonsWithLowerMae).toBe(2);
    expect(gate.passed).toBe(false);
  });
});
