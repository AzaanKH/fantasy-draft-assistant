import { afterEach, describe, expect, it, vi } from 'vitest';
import * as recommendations from '../lib/calculations/recommendations';
import {
  __testables,
  runPrimaryLeagueExperiments,
} from './primary-league-experiments';

afterEach(() => { vi.restoreAllMocks(); });

describe('Primary League experiments', () => {
  it('includes material depth value while preserving audit factor order', () => {
    const flags = { leagueValue: true, rosterFit: true, depthValue: true, tierSupply: true, draftTiming: true };
    expect(__testables.getAuditFactors(flags)).toEqual([
      'league-value', 'roster-fit', 'depth-value', 'tier-supply', 'draft-timing',
    ]);
    expect(__testables.getAuditFactors({ ...flags, depthValue: false })).toEqual([
      'league-value', 'roster-fit', 'tier-supply', 'draft-timing',
    ]);
  });

  it('summarizes a metric with a stable distribution and mean interval', () => {
    expect(__testables.summarizeMetric([10, 20, 30, 40])).toMatchObject({
      mean: 25,
      p10: 13,
      p90: 37,
    });
  });

  it('runs every requested experiment and keeps Best Pick inside its boundary', () => {
    const recommend = vi.spyOn(recommendations, 'getRecommendations');
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
    expect(recommend.mock.calls.length).toBeGreaterThan(0);
    for (const [, , , context] of recommend.mock.calls) {
      expect(context?.rosterPlayers?.length).toBeGreaterThan(0);
      expect(context?.rosterPlayers?.length).toBe(
        Object.values(context?.rosterCounts ?? {}).reduce((sum, count) => sum + count, 0)
      );
    }
    expect(report.bestPickAudit.decisions).toBeGreaterThan(0);
    expect(report.bestPickAudit.boundaryViolations).toBe(0);
    expect(
      report.openingPlanTournament.strategies.every((strategy) =>
        Number.isFinite(strategy.starterProjectedPoints.mean)
      )
    ).toBe(true);
  }, 60_000);
});
