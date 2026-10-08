import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
  createDefaultLeagueSettings,
  createLeagueSettings,
  type DraftReadinessKey,
  type DraftReadinessSourceObservation,
} from '@fantasy-draft/shared';
import { createQuickMockSettings } from './quick-mock-settings';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';
import {
  blocksRecommendations,
  blocksLiveRecommendations,
  evaluateWorkspaceDraftReadiness,
} from './draft-readiness';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const FRESH = '2026-08-20T11:00:00.000Z';

const sources: Partial<Record<DraftReadinessKey, DraftReadinessSourceObservation>> = {
  'trusted-rankings': { availability: 'available', timestamp: FRESH },
  'canonical-player-identities': { availability: 'available', timestamp: FRESH },
  'experimental-predictions': { availability: 'available', timestamp: FRESH },
  'contract-context': { availability: 'available', timestamp: FRESH },
  'sportsbook-context': { availability: 'available', timestamp: FRESH },
};

const readyKeepers: KeeperPreloadStatus = {
  season: 2026,
  confirmedAt: FRESH,
  configuredCount: 10,
  resolvedCount: 10,
  canonicalCount: 10,
  unresolvedNames: [],
  duplicateNames: [],
  invalidAssignments: [],
  isLoading: false,
  isError: false,
  isInitialized: true,
  isConfirmed: true,
  isMockReady: true,
  error: null,
};

const primaryLeagueSettings = createLeagueSettings({
  source: 'sleeper',
  leagueId: 'primary-league',
  totalTeams: 10,
  scoringRules: DEFAULT_SCORING_RULES,
  rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
  keepersEnabled: true,
}, NOW - 60 * 60 * 1000);

describe('Draft Workspace readiness adapter', () => {
  it('is ready only when provider settings and keeper supply match the Primary League', () => {
    const report = evaluateWorkspaceDraftReadiness({
      sources,
      warnings: [],
      leagueSettings: primaryLeagueSettings,
      totalRounds: 14,
      keeperStatus: readyKeepers,
    }, NOW);

    expect(report.status).toBe('ready');
    expect(report.productBlockingFailures).toHaveLength(0);
  });

  it('blocks with an actionable Primary League settings diagnosis before provider confirmation', () => {
    const report = evaluateWorkspaceDraftReadiness({
      sources,
      warnings: [],
      leagueSettings: createDefaultLeagueSettings(NOW),
      totalRounds: 14,
      keeperStatus: readyKeepers,
    }, NOW);

    expect(report.productBlockingFailures).toHaveLength(1);
    expect(report.productBlockingFailures[0]).toMatchObject({
      key: 'primary-league-settings',
      problem: 'missing',
    });
    expect(report.productBlockingFailures[0]?.correctiveAction).toContain(
      'Reconnect the Primary League draft'
    );
  });

  it('blocks unresolved keepers but keeps an older current-season confirmation valid', () => {
    const invalid = evaluateWorkspaceDraftReadiness({
      sources,
      warnings: [],
      leagueSettings: primaryLeagueSettings,
      totalRounds: 14,
      keeperStatus: {
        ...readyKeepers,
        resolvedCount: 9,
        unresolvedNames: ['Unresolved Player'],
        isMockReady: false,
      },
    }, NOW);
    const olderConfirmation = evaluateWorkspaceDraftReadiness({
      sources,
      warnings: [],
      leagueSettings: primaryLeagueSettings,
      totalRounds: 14,
      keeperStatus: {
        ...readyKeepers,
        confirmedAt: '2026-08-01T00:00:00.000Z',
      },
    }, NOW);

    expect(invalid.productBlockingFailures[0]).toMatchObject({
      key: 'confirmed-keeper-supply',
      problem: 'invalid',
    });
    expect(
      olderConfirmation.productBlockingFailures.some(
        (failure) => failure.key === 'confirmed-keeper-supply'
      )
    ).toBe(false);
  });

  it('blocks duplicate keeper entries with an actionable diagnosis', () => {
    const report = evaluateWorkspaceDraftReadiness({
      sources,
      warnings: [],
      leagueSettings: primaryLeagueSettings,
      totalRounds: 14,
      keeperStatus: {
        ...readyKeepers,
        resolvedCount: 9,
        duplicateNames: ['James Cook III'],
        isMockReady: false,
      },
    }, NOW);

    const keeperFailure = report.productBlockingFailures.find(
      (failure) => failure.key === 'confirmed-keeper-supply'
    );
    expect(keeperFailure).toMatchObject({ problem: 'invalid' });
    expect(keeperFailure?.message).toContain('Duplicate keeper entries: James Cook III');
    expect(keeperFailure?.message).toContain('exactly once');
  });

  it('blocks illegal or conflicting keeper assignments', () => {
    const report = evaluateWorkspaceDraftReadiness({
      sources,
      warnings: [],
      leagueSettings: primaryLeagueSettings,
      totalRounds: 14,
      keeperStatus: {
        ...readyKeepers,
        canonicalCount: 9,
        invalidAssignments: ['Player, team 2, round 4 conflicts with another keeper'],
        isInitialized: false,
        isMockReady: false,
      },
    }, NOW);

    const keeperFailure = report.productBlockingFailures.find(
      (failure) => failure.key === 'confirmed-keeper-supply'
    );
    expect(keeperFailure).toMatchObject({ problem: 'invalid' });
    expect(keeperFailure?.message).toContain('Invalid keeper assignments');
    expect(keeperFailure?.message).toContain('team 2, round 4');
  });

  it('keeps recommendations off until valid keepers reach the draft store', () => {
    const report = evaluateWorkspaceDraftReadiness({
      sources,
      warnings: [],
      leagueSettings: primaryLeagueSettings,
      totalRounds: 14,
      keeperStatus: {
        ...readyKeepers,
        isInitialized: false,
        isMockReady: false,
      },
    }, NOW);

    expect(report.productBlockingFailures).toEqual([
      expect.objectContaining({ key: 'confirmed-keeper-supply', problem: 'missing' }),
    ]);
    expect(blocksRecommendations('setup', report)).toBe(true);
    expect(blocksRecommendations('mock', report)).toBe(true);
    expect(blocksRecommendations('live', report)).toBe(true);
  });

  it('suppresses Recommendations only in a blocked live session', () => {
    const blocked = evaluateWorkspaceDraftReadiness({
      sources,
      warnings: [],
      leagueSettings: createDefaultLeagueSettings(NOW),
      totalRounds: 14,
      keeperStatus: readyKeepers,
    }, NOW);

    expect(blocksLiveRecommendations('live', blocked)).toBe(true);
    expect(blocksLiveRecommendations('setup', blocked)).toBe(false);
    expect(blocksLiveRecommendations('mock', blocked)).toBe(false);
    expect(blocksRecommendations('setup', blocked)).toBe(false);
    expect(blocksRecommendations('live', blocked)).toBe(true);
  });
});

describe('Sleeper mock readiness with Primary League practice settings', () => {
  const input = {
    sources,
    warnings: [],
    leagueSettings: createDefaultLeagueSettings(NOW),
    totalRounds: 15,
    keeperStatus: readyKeepers,
  };

  it('allows an explicitly selected Primary League profile with a 15-round mock', () => {
    const report = evaluateWorkspaceDraftReadiness({ ...input, usePrimaryLeagueSettings: true }, NOW);
    expect(report.status).toBe('ready');
    expect(blocksLiveRecommendations('live', report)).toBe(false);
  });

  it('still blocks missing provider settings when practice mode is off', () => {
    expect(evaluateWorkspaceDraftReadiness(input, NOW).productBlockingFailures)
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: 'primary-league-settings' })]));
  });

  it('keeps rankings and keeper checks active in practice mode', () => {
    const report = evaluateWorkspaceDraftReadiness({
      ...input, usePrimaryLeagueSettings: true,
      sources: { ...sources, 'trusted-rankings': { availability: 'missing', timestamp: null } },
      keeperStatus: { ...readyKeepers, isConfirmed: false },
    }, NOW);
    expect(report.productBlockingFailures.map((item) => item.key))
      .toEqual(expect.arrayContaining(['trusted-rankings', 'confirmed-keeper-supply']));
  });

  it('rejects practice drafts that cannot reproduce Primary League roster requirements', () => {
    for (const overrides of [
      { totalRounds: 10 },
      { leagueSettings: createLeagueSettings({ ...createDefaultLeagueSettings(NOW), totalTeams: 12 }, NOW) },
    ]) {
      const report = evaluateWorkspaceDraftReadiness({ ...input, ...overrides, usePrimaryLeagueSettings: true }, NOW);
      expect(report.productBlockingFailures.map((item) => item.key)).toContain('primary-league-settings');
    }
  });
});


describe('Quick mock readiness', () => {
  const input = {
    sources, warnings: [], leagueSettings: createQuickMockSettings(undefined, NOW),
    totalRounds: 15, useQuickMockSettings: true,
    keeperStatus: { ...readyKeepers, season: undefined, confirmedAt: null,
      configuredCount: 0, resolvedCount: 0, canonicalCount: 0 },
  };

  it('needs no Primary League settings or keeper file for local and Sleeper mocks', () => {
    const report = evaluateWorkspaceDraftReadiness(input, NOW);
    expect(report.status).toBe('ready');
    expect(report.coreDraftData.find((item) => item.key === 'primary-league-settings')?.label).toBe('Quick mock settings');
    expect(blocksRecommendations('mock', report, true)).toBe(false);
    expect(blocksLiveRecommendations('live', report)).toBe(false);
  });

  it('does not let an actual league silently fall back to quick mock rules', () => {
    const report = evaluateWorkspaceDraftReadiness({ ...input, useQuickMockSettings: false }, NOW);
    expect(blocksLiveRecommendations('live', report)).toBe(true);
    expect(report.productBlockingFailures.map((item) => item.key)).toContain('primary-league-settings');
  });

  it('still requires current rankings and identities for a quick mock', () => {
    const report = evaluateWorkspaceDraftReadiness({ ...input,
      sources: { ...sources, 'trusted-rankings': { availability: 'missing', timestamp: null } },
    }, NOW);
    expect(report.productBlockingFailures.map((item) => item.key)).toEqual(['trusted-rankings']);
    expect(blocksRecommendations('setup', report, true)).toBe(true);
    expect(blocksRecommendations('mock', report, true)).toBe(true);
    expect(blocksLiveRecommendations('live', report)).toBe(true);
  });

  it('blocks incompatible roster sizes and waits for old keeper reservations to clear', () => {
    const report = evaluateWorkspaceDraftReadiness({ ...input, totalRounds: 8,
      keeperStatus: { ...input.keeperStatus, canonicalCount: 10, isInitialized: false },
    }, NOW);
    expect(report.productBlockingFailures.map((item) => item.key)).toEqual(
      expect.arrayContaining(['primary-league-settings', 'confirmed-keeper-supply'])
    );
  });
});

describe('Static demo readiness', () => {
  const MONTHS_LATER = NOW + 90 * 24 * 60 * 60 * 1000;
  const input = {
    sources, warnings: [], leagueSettings: createQuickMockSettings(undefined, NOW),
    totalRounds: 15, useQuickMockSettings: true,
    keeperStatus: { ...readyKeepers, season: undefined, confirmedAt: null,
      configuredCount: 0, resolvedCount: 0, canonicalCount: 0 },
  };

  it('keeps the bundled snapshot usable after the live age limits pass', () => {
    expect(evaluateWorkspaceDraftReadiness(input, MONTHS_LATER).productBlockingFailures.map((item) => item.key))
      .toEqual(['trusted-rankings', 'canonical-player-identities']);
    const report = evaluateWorkspaceDraftReadiness({ ...input, demo: true }, MONTHS_LATER);
    expect(report.status).toBe('ready');
    expect(blocksRecommendations('mock', report, true)).toBe(false);
  });

  it('names the demo ranking source instead of FantasyPros', () => {
    const report = evaluateWorkspaceDraftReadiness({ ...input, demo: true, demoRankingsSource: 'Demo rankings',
      sources: { ...sources, 'trusted-rankings': { availability: 'invalid', timestamp: FRESH } },
    }, NOW);
    const rankings = report.productBlockingFailures.find((item) => item.key === 'trusted-rankings');
    expect(rankings?.sourceLabel).toBe('Demo rankings');
    expect(rankings?.message).not.toContain('FantasyPros');
    expect(rankings?.correctiveAction).not.toContain('refresh:fantasypros');
  });
});
