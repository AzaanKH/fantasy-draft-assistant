import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { POSITIONS, type Player } from '@fantasy-draft/shared';
import { useRecommendations } from './useRecommendations';
import { createDraftStore, DraftStoreProvider } from '@/stores/draftStore';
import { createQuickMockSettings } from '@/lib/quick-mock-settings';
import type { PersistedDraftSyncConnection } from '@/stores/draftSyncStore';
import type { LocalLeagueProfile } from '@/stores/leagueSetupStore';
import type { LeagueSurvivalModel } from '@/lib/calculations/survival';

const setup = vi.hoisted(() => ({
  profile: 'quick-mock' as LocalLeagueProfile,
  connection: null as PersistedDraftSyncConnection | null,
}));
vi.mock('@/stores/leagueSetupStore', () => ({
  useLeagueSetupStore: (selector: (state: typeof setup) => unknown) => selector(setup),
}));
vi.mock('@/stores/draftSyncStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/stores/draftSyncStore')>(),
  useDraftSyncConnectionStore: Object.assign(
    (selector: (state: typeof setup) => unknown) => selector(setup),
    { getState: () => setup, subscribe: vi.fn() }
  ),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('./usePlayerData', () => ({
  usePlayerDataQuery: () => ({ players: [player], isLoading: false, dataInfo: {} }),
}));
vi.mock('./useTeamNeeds', () => ({
  useTeamNeeds: () => ({ needs: [], isLoading: false }),
}));

const player: Player = {
  id: 'qb', name: 'Quarterback', position: 'QB', team: 'BAL', byeWeek: 7,
  ecrRank: 38, positionalRank: 6, sleeperAdp: 40, consensusAdp: 40,
  valueScore: 2, marketRank: 40, marketAdp: 40, marketAdpTrend: 0,
  isContractYear: false, offensiveEnvironmentScore: 7, projectedPoints: 250,
  valueOverReplacement: 20, tier: 1, tierDropoffScore: 0.8,
  nextPickSurvivalProbability: 0.5, ceilingScore: 9, floorScore: 7,
  upsideScore: 8, uncertaintyScore: 4, injuryRiskScore: 1,
  predictionSource: 'heuristic', newsStatus: 'healthy', stackPartnerTeam: 'BAL',
  highlightLevel: 'neutral',
};
const model: LeagueSurvivalModel = {
  generatedAt: '2026-09-16T00:00:00Z', modelVersion: 'test', leagueName: 'Primary League',
  seasons: [2025], sampleSize: 140,
  positions: Object.fromEntries(POSITIONS.map((position) => [position, {
    position, leagueMedianPick: 20, sleeperMedianPick: 40, pickPremium: -20,
    top50RateDelta: 0.2, top100RateDelta: 0.1, sampleSize: 20,
  }])) as LeagueSurvivalModel['positions'],
};
let store: ReturnType<typeof createDraftStore>;
let result: ReturnType<typeof useRecommendations>;
let enabled = true;
let queryLoading = false;
let cachedModel: LeagueSurvivalModel | null = model;
let queryOptions: { enabled?: boolean; queryKey: readonly unknown[] };
function Probe() { result = useRecommendations(5, enabled); return null; }
function render() {
  // Server rendering reads the initial snapshot; expose the configured test room.
  store.getInitialState = store.getState;
  renderToStaticMarkup(createElement(DraftStoreProvider, { store, children: createElement(Probe) }));
}

beforeEach(() => {
  setup.profile = 'quick-mock';
  setup.connection = null;
  enabled = true;
  queryLoading = false;
  cachedModel = model;
  store = createDraftStore({ storage: null });
  store.getState().applyLeagueSettings(createQuickMockSettings());
  store.getState().setConfig({ totalTeams: 12, totalRounds: 15, myPickPosition: 1 });
  vi.mocked(useQuery).mockImplementation(((options: typeof queryOptions) => {
    queryOptions = options;
    return { data: cachedModel, isLoading: queryLoading };
  }) as typeof useQuery);
});

describe('recommendation timing by league profile', () => {
  it('keeps generic 12-team mocks on market timing even with cached history and mock overrides', () => {
    store.setState({ sessionMode: 'mock', mockSurvivalProbabilities: { qb: 0.01 } });
    queryLoading = true;
    render();
    expect(queryOptions.enabled).toBe(false);
    expect(result.isLoading).toBe(false);
    const diagnostics = result.topPick?.diagnostics;
    expect(diagnostics?.survivalModelSource).toBe('heuristic');
    expect(diagnostics?.nextPickNumber).toBe(24);
    expect(diagnostics?.nextPickSurvivalProbability).toBeGreaterThan(0.01);
    expect(diagnostics?.historicalExpectedPick).toBeUndefined();
    expect(diagnostics?.leaguePositionTendency).toBeUndefined();
  });

  it('attaches history for an explicit Primary League profile and removes it when switching back', () => {
    setup.profile = 'primary-league';
    store.getState().setConfig({ totalTeams: 10, totalRounds: 14 });
    render();
    expect(queryOptions.enabled).toBe(true);
    expect(queryOptions.queryKey).toEqual(['league-survival-model', 'primary-league']);
    expect(result.topPick?.diagnostics?.survivalModelSource).toBe('league-history');
    expect(result.topPick?.diagnostics?.historicalExpectedPick).toBeDefined();
    setup.profile = 'quick-mock';
    render();
    expect(queryOptions.enabled).toBe(false);
    expect(result.topPick?.diagnostics?.survivalModelSource).toBe('heuristic');
    expect(result.topPick?.diagnostics?.historicalExpectedPick).toBeUndefined();
  });

  it('prioritizes a connected Quick Mock over saved Primary League preferences', () => {
    setup.profile = 'primary-league';
    setup.connection = { provider: 'sleeper', draftId: 'mock', draftPosition: 1, settingsProfile: 'quick-mock' };
    render();
    expect(queryOptions.enabled).toBe(false);
    expect(result.topPick?.diagnostics?.survivalModelSource).toBe('heuristic');
  });

  it('attaches history for explicitly connected Primary League practice settings', () => {
    setup.connection = { provider: 'sleeper', draftId: 'mock', draftPosition: 1, usePrimaryLeagueSettings: true };
    render();
    expect(queryOptions.enabled).toBe(true);
    expect(result.topPick?.diagnostics?.survivalModelSource).toBe('league-history');
  });

  it('falls back to market timing when selected history is unavailable', () => {
    setup.profile = 'primary-league';
    cachedModel = null;
    render();
    expect(result.topPick?.diagnostics?.survivalModelSource).toBe('heuristic');
    expect(result.topPick?.diagnostics?.survivalModelSampleSize).toBeUndefined();
  });

  it('does not load history while recommendations are disabled', () => {
    setup.profile = 'primary-league';
    enabled = false;
    queryLoading = true;
    render();
    expect(queryOptions.enabled).toBe(false);
    expect(result.isLoading).toBe(false);
    expect(result.topPick).toBeNull();
  });
});
