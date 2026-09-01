import { describe, expect, it } from 'vitest';
import {
  RELEASE_CHECKS,
  buildPrimaryLeagueReleaseGateReport,
  type ReleaseCheckOutcome,
} from './primary-league-release-gate.js';

function passingOutcomes(): ReleaseCheckOutcome[] {
  return RELEASE_CHECKS.map((check) => ({
    key: check.key,
    label: check.label,
    status: 'passed',
    commands: [{
      command: 'fixture',
      status: 'passed',
      exitCode: 0,
      durationMs: 1,
    }],
  }));
}

describe('Primary League release gate report', () => {
  it('activates feature freeze only after every check and live rehearsal pass', () => {
    const report = buildPrimaryLeagueReleaseGateReport({
      now: Date.parse('2026-09-05T20:00:00.000Z'),
      outcomes: passingOutcomes(),
      readiness: {
        productBlockingFailures: [],
        actionableWarnings: [{ label: 'Review timing data' }],
        optionalSignalDegradations: [{ label: 'Sportsbook context' }],
      },
      rehearsal: { status: 'passed', failures: [] },
      operational: {
        draftId: 'primary-draft',
        scheduledStartAt: '2026-09-05T18:00:40.000Z',
        realProviderRehearsal: { status: 'passed', completedAt: '2026-09-05T19:45:00.000Z' },
      },
    });

    expect(report.status).toBe('feature-freeze');
    expect(report.featureFreeze.status).toBe('active');
    expect(report.productBlockingFailures).toEqual([]);
    expect(report.releaseBlockingFailures).toEqual([]);
    expect(report.actionableWarnings).toHaveLength(1);
    expect(report.optionalSignalDegradations).toHaveLength(1);
  });

  it('keeps feature freeze pending and separates product, release, and optional evidence', () => {
    const outcomes = passingOutcomes();
    outcomes[0] = { ...outcomes[0]!, status: 'failed' };
    const report = buildPrimaryLeagueReleaseGateReport({
      now: Date.parse('2026-08-25T16:00:00.000Z'),
      outcomes,
      readiness: {
        productBlockingFailures: [{ label: 'Rankings stale' }],
        actionableWarnings: [{ label: 'League history' }],
        optionalSignalDegradations: [{ label: 'Experimental model' }],
      },
      rehearsal: { status: 'passed', failures: [] },
      operational: {
        realProviderRehearsal: { status: 'scheduled', completedAt: null },
      },
    });

    expect(report.status).toBe('blocked');
    expect(report.featureFreeze.status).toBe('pending');
    expect(report.productBlockingFailures).toHaveLength(2);
    expect(report.releaseBlockingFailures).toEqual([
      expect.objectContaining({ key: 'build' }),
    ]);
    expect(report.actionableWarnings).toHaveLength(1);
    expect(report.optionalSignalDegradations).toHaveLength(1);
  });

  it.each([null, 'not-a-timestamp', '2026-09-05T20:00:01.000Z'])(
    'rejects passed rehearsal evidence without a valid completion time: %s',
    (completedAt) => {
      const report = buildPrimaryLeagueReleaseGateReport({
        now: Date.parse('2026-09-05T20:00:00.000Z'),
        outcomes: passingOutcomes(),
        readiness: { productBlockingFailures: [] },
        rehearsal: { status: 'passed', failures: [] },
        operational: {
          realProviderRehearsal: { status: 'passed', completedAt },
        },
      });

      expect(report.status).toBe('blocked');
      expect(report.featureFreeze.status).toBe('pending');
      expect(report.productBlockingFailures).toEqual([
        expect.objectContaining({ key: 'real-provider-rehearsal' }),
      ]);
    }
  );
});
