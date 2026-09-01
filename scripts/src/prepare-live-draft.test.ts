import { describe, expect, it } from 'vitest';
import {
  DRAFT_READINESS_DEFINITIONS,
  evaluateDraftReadiness,
  type DraftReadinessDefinition,
  type DraftReadinessKey,
  type DraftReadinessSourceObservation,
} from '@fantasy-draft/shared';
import {
  LIVE_CORE_REFRESH_STEPS,
  LIVE_DRAFT_PREP_REPORT_STEP,
  findPreConnectFailures,
} from './prepare-live-draft.js';

const NOW = Date.parse('2026-08-23T12:00:00.000Z');
const FRESH = '2026-08-23T11:00:00.000Z';

function readySources(): Record<DraftReadinessKey, DraftReadinessSourceObservation> {
  return Object.fromEntries(
    DRAFT_READINESS_DEFINITIONS.map((definition: DraftReadinessDefinition) => [
      definition.key,
      { availability: 'available', timestamp: FRESH },
    ])
  ) as Record<DraftReadinessKey, DraftReadinessSourceObservation>;
}

describe('live draft preflight', () => {
  it('refreshes both source files before rebuilding player identities', () => {
    expect(LIVE_CORE_REFRESH_STEPS.map((step) => step.script)).toEqual([
      'refresh:sleeper',
      'refresh:fantasypros',
      'data:identity',
    ]);
  });

  it('regenerates the draft prep report after the core preflight', () => {
    expect(LIVE_DRAFT_PREP_REPORT_STEP).toEqual({
      label: 'Draft prep report',
      script: 'report:draft-prep',
    });
  });

  it('leaves provider settings for the live connection', () => {
    const sources = readySources();
    sources['primary-league-settings'] = {
      availability: 'missing',
      timestamp: null,
    };
    const report = evaluateDraftReadiness({ sources }, NOW);

    expect(report.status).toBe('blocked');
    expect(findPreConnectFailures(report)).toEqual([]);
  });

  it('stops before startup when a local core file or Sleeper directory is not ready', () => {
    const sources = readySources();
    sources['trusted-rankings'] = {
      availability: 'missing',
      timestamp: null,
    };
    const report = evaluateDraftReadiness({
      sources,
      warnings: [{
        key: 'data/sleeper-adp.json',
        label: 'Sleeper player directory',
        sourceLabel: 'Sleeper player directory',
        message: 'Sleeper player directory needs attention.',
        correctiveAction: 'Run `pnpm refresh:sleeper`.',
      }],
    }, NOW);

    expect(findPreConnectFailures(report).map((failure) => failure.label)).toEqual([
      'Trusted rankings',
      'Sleeper player directory',
    ]);
  });
});
