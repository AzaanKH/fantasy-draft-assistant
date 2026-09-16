import { describe, expect, it } from 'vitest';
import {
  __testables,
  runPrimaryLeagueExperiments,
} from './primary-league-experiments';

describe('Primary League experiments', () => {
  it('summarizes a metric with a stable distribution and mean interval', () => {
    expect(__testables.summarizeMetric([10, 20, 30, 40])).toMatchObject({
      mean: 25,
      p10: 13,
      p90: 37,
    });
  });

  it('runs every requested experiment and keeps Best Pick inside its boundary', () => {
    const report = runPrimaryLeagueExperiments({
      seed: 77,
      scale: {
        tournamentIterations: 2,
        timingIterations: 2,
        stressIterations: 2,
        sensitivityIterations: 2,
        scoringIterations: 2,
        waitMapIterations: 10,
      },
    });

    expect(report.openingPlanTournament.strategies).toHaveLength(8);
    expect(report.takeNowOrWaitMap.decisions.length).toBeGreaterThan(0);
    expect(report.qbAndTeTiming.qb).toHaveLength(3);
    expect(report.qbAndTeTiming.te).toHaveLength(3);
    expect(report.positionalRunStressTest.scenarios).toHaveLength(5);
    expect(report.opponentModelSensitivity.scenarios).toHaveLength(5);
    expect(report.scoringRuleAblation.scenarios).toHaveLength(4);
    expect(report.bestPickAudit.decisions).toBeGreaterThan(0);
    expect(report.bestPickAudit.boundaryViolations).toBe(0);
    expect(
      report.openingPlanTournament.strategies.every((strategy) =>
        Number.isFinite(strategy.starterProjectedPoints.mean)
      )
    ).toBe(true);
  }, 60_000);
});
