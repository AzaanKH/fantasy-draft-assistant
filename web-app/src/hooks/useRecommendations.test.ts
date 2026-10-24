import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { POSITIONS, type Player } from '@fantasy-draft/shared/league';
import { useRecommendations } from './useRecommendations';
import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { createQuickMockSettings, type LeagueSurvivalModel } from '@fantasy-draft/shared/draft';
import type { PersistedDraftSyncConnection } from '@/workspace/connection-hints';
import type { LocalLeagueProfile } from '@/stores/leagueSetupStore';

const setup = vi.hoisted(() => ({
  profile: 'quick-mock' as LocalLeagueProfile,
  connection: null as PersistedDraftSyncConnection | null,
}));
vi.mock('@/stores/leagueSetupStore', () => ({
  useLeagueSetupStore: (selector: (state: typeof setup) => unknown) => selector(setup),
}));
vi.mock('@/workspace/WorkspaceProvider', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/workspace/WorkspaceProvider')>(),
  useConnectionState: (selector: (state: typeof setup) => unknown) => selector(setup),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('./usePlayerData', () => ({
  usePlayerDataQuery: () => ({ players: catalog, isLoading: false, dataInfo: {} }),
}));
vi.mock('./useTeamNeeds', () => ({
  useTeamNeeds: () => ({ needs: [], isLoading: false }),
}));

const player: Player = {
  id: 'qb', name: 'Quarterback', position: 'QB', team: 'BAL', byeWeek: 7,
  ecrRank: asRank(38), positionalRank: asRank(6), sleeperAdp: 40, consensusAdp: 40,
  valueScore: 2, marketRank: 40, marketAdp: 40, marketAdpTrend: 0,
  isContractYear: false, offensiveEnvironmentScore: 7, projectedPoints: 250,
  valueOverReplacement: asVor(20), tier: 1, tierDropoffScore: 0.8,
  nextPickSurvivalProbability: asProbability(0.5), ceilingScore: 9, floorScore: 7,
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
let catalog: readonly Player[] = [player];
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
  renderToStaticMarkup(createElement(WorkspaceTestProvider, { store, children: createElement(Probe) }));
}

beforeEach(() => {
  catalog = [player];
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
    store.setState({ sessionMode: 'mock', mockSurvivalProbabilities: { qb: asProbability(0.01) } });
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

it('keeps drafted players in the historical survival cohort while filtering browse availability', () => {
  setup.profile = 'primary-league';
  const earlier: Player = { ...player, id: 'earlier', name: 'Earlier Quarterback', ecrRank: asRank(1), consensusAdp: 1, marketAdp: 1 };
  catalog = [earlier, player];
  cachedModel = { ...model, historicalPickNumbers: { QB: [1, 5, 10, 20, 30, 50, 80, 100] } };
  store.getState().setConfig({ totalTeams: 10, totalRounds: 14 });
  store.getState().markPlayerDrafted(earlier.id, earlier.name, earlier.position, 0, 'My Team');
  render();
  expect(result.topPick?.playerId).toBe(player.id);
  expect(result.topPick?.diagnostics?.historicalExpectedPick).toBe(100);
});
