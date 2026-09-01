import { describe, expect, it } from 'vitest';
import {
  CORE_DRAFT_DATA_KEYS,
  DRAFT_READINESS_DEFINITIONS,
  OPTIONAL_SIGNAL_KEYS,
  evaluateDraftReadiness,
  type DraftReadinessDefinition,
  type DraftReadinessItem,
  type DraftReadinessKey,
  type DraftReadinessSourceObservation,
} from '@fantasy-draft/shared';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const FRESH = '2026-08-20T11:00:00.000Z';
const STALE = '2026-07-01T00:00:00.000Z';

function readySources(): Record<DraftReadinessKey, DraftReadinessSourceObservation> {
  return Object.fromEntries(
    DRAFT_READINESS_DEFINITIONS.map((definition: DraftReadinessDefinition) => [
      definition.key,
      { availability: 'available', timestamp: FRESH },
    ])
  ) as Record<DraftReadinessKey, DraftReadinessSourceObservation>;
}

describe('Draft Readiness scenarios', () => {
  it('classifies exactly four Core Draft Data categories and three Optional Signals', () => {
    const report = evaluateDraftReadiness({ sources: readySources() }, NOW);

    expect(report.coreDraftData.map((item: DraftReadinessItem) => item.key)).toEqual(CORE_DRAFT_DATA_KEYS);
    expect(report.optionalSignals.map((item: DraftReadinessItem) => item.key)).toEqual(OPTIONAL_SIGNAL_KEYS);
    expect(report.status).toBe('ready');
  });

  for (const key of CORE_DRAFT_DATA_KEYS) {
    const seasonScopedConfirmation =
      key === 'primary-league-settings' || key === 'confirmed-keeper-supply';
    const scenarios = seasonScopedConfirmation
      ? (['missing', 'invalid'] as const)
      : (['missing', 'invalid', 'stale'] as const);
    for (const scenario of scenarios) {
      it(`blocks live Recommendations when ${key} is ${scenario}`, () => {
        const sources = readySources();
        sources[key] = scenario === 'missing'
          ? { availability: 'missing', timestamp: null }
          : scenario === 'invalid'
            ? { availability: 'invalid', timestamp: FRESH, detail: 'Fixture validation failed.' }
            : { availability: 'available', timestamp: STALE };

        const report = evaluateDraftReadiness({ sources }, NOW);

        expect(report.status).toBe('blocked');
        expect(report.productBlockingFailures).toHaveLength(1);
        expect(report.productBlockingFailures[0]).toMatchObject({
          key,
          status: 'blocking',
          problem: scenario,
          classification: 'core-draft-data',
        });
        expect(report.productBlockingFailures[0]?.correctiveAction).not.toBe('');
      });
    }
  }

  it('does not expire saved Primary League settings confirmation with age', () => {
    const sources = readySources();
    sources['primary-league-settings'] = {
      availability: 'available',
      timestamp: STALE,
    };

    const report = evaluateDraftReadiness({ sources }, NOW);

    expect(report.productBlockingFailures).toHaveLength(0);
    expect(
      report.coreDraftData.find(
        (item: DraftReadinessItem) => item.key === 'primary-league-settings'
      )
    ).toMatchObject({ status: 'ready', problem: null });
  });

  it('does not expire a confirmed current-season keeper list with age', () => {
    const sources = readySources();
    sources['confirmed-keeper-supply'] = {
      availability: 'available',
      timestamp: STALE,
    };

    const report = evaluateDraftReadiness({ sources }, NOW);

    expect(report.productBlockingFailures).toHaveLength(0);
    expect(
      report.coreDraftData.find(
        (item: DraftReadinessItem) => item.key === 'confirmed-keeper-supply'
      )
    ).toMatchObject({ status: 'ready', problem: null });
  });

  for (const key of OPTIONAL_SIGNAL_KEYS) {
    for (const scenario of ['missing', 'invalid', 'stale'] as const) {
      it(`degrades ${key} independently when it is ${scenario}`, () => {
        const sources = readySources();
        sources[key] = scenario === 'missing'
          ? { availability: 'missing', timestamp: null }
          : scenario === 'invalid'
            ? { availability: 'invalid', timestamp: FRESH, detail: 'Fixture validation failed.' }
            : { availability: 'available', timestamp: STALE };

        const report = evaluateDraftReadiness({ sources }, NOW);

        expect(report.status).toBe('ready');
        expect(report.productBlockingFailures).toHaveLength(0);
        expect(report.optionalSignalDegradations).toHaveLength(1);
        expect(report.optionalSignalDegradations[0]).toMatchObject({
          key,
          status: 'degraded',
          problem: scenario,
          classification: 'optional-signal',
        });
      });
    }
  }

  it('states both sides of a failed dependency timestamp comparison', () => {
    const sources = readySources();
    sources['canonical-player-identities'] = {
      availability: 'available',
      timestamp: '2026-08-20T09:00:00.000Z',
      dependencies: [{
        key: 'trusted-rankings',
        label: 'Trusted rankings',
        timestamp: '2026-08-20T10:00:00.000Z',
      }],
    };

    const report = evaluateDraftReadiness({ sources }, NOW);
    const blocker = report.productBlockingFailures[0];

    expect(blocker?.problem).toBe('older-than-dependency');
    expect(blocker?.message).toContain('canonical player identities artifact (2026-08-20T09:00:00.000Z) is older');
    expect(blocker?.message).toContain('Trusted rankings (2026-08-20T10:00:00.000Z)');
    expect(blocker?.message).toContain('trusted rankings dependency is newer');
    expect(blocker?.correctiveAction).toContain('pnpm data:identity');
  });

  it('reports product blockers, warnings, optional degradation, and engineering checks separately', () => {
    const sources = readySources();
    sources['trusted-rankings'] = { availability: 'missing', timestamp: null };
    sources['sportsbook-context'] = { availability: 'missing', timestamp: null };

    const report = evaluateDraftReadiness({
      sources,
      warnings: [{
        key: 'league-history',
        label: 'League history',
        sourceLabel: 'Primary League draft history',
        message: 'League history needs refresh.',
        correctiveAction: 'Run the history importer.',
      }],
    }, NOW);

    expect(report.summary).toEqual({
      productBlockingFailures: 1,
      actionableWarnings: 1,
      optionalSignalDegradations: 1,
    });
    expect(report.engineeringChecks).toMatchObject({ status: 'not-run' });
    expect(report.engineeringChecks.commands).toEqual([
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm build',
    ]);
  });
});
