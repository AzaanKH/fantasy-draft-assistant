import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { LivePlayerDataProvider, usePlayerDataQuery, type PlayerDataQueryResult } from './usePlayerData';
import type { PersistedDraftSyncConnection } from '@/workspace/connection-hints';
import { SAFE_RECOMMENDATION_POLICY } from '@fantasy-draft/shared/catalog';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
const draftState = vi.hoisted(() => ({ connection: null as PersistedDraftSyncConnection | null, demo: false }));
vi.mock('@/lib/demo-mode', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/demo-mode')>(),
  get IS_DEMO() { return draftState.demo; },
}));
vi.mock('@/workspace/WorkspaceProvider', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/workspace/WorkspaceProvider')>(),
  useConnectionState: (selector: (state: typeof draftState) => unknown) => selector(draftState),
}));

let loadedData: Record<string, unknown> = {};
let coreLoading = false;
let shadowEnabled = false;
let predictionEnabled: unknown;
let result: PlayerDataQueryResult;
function Probe() { result = usePlayerDataQuery(); return null; }
function render() { renderToStaticMarkup(createElement(WorkspaceTestProvider, {store: createDraftStore(), children: createElement(LivePlayerDataProvider, null, createElement(Probe))})); }

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-09-10T12:00:00Z') });
  loadedData = {};
  coreLoading = false;
  shadowEnabled = false;
  predictionEnabled = undefined;
  draftState.connection = null;
  draftState.demo = false;
  vi.mocked(useQuery).mockImplementation(((options: { queryKey: string[]; enabled?: boolean }) => {
    const key = options.queryKey[0] ?? '';
    if (key === 'predictions') predictionEnabled = options.enabled;
    const core = key === 'fantasypros-snapshot' || key === 'player-identity';
    const policy = key === 'recommendation-policy';
    return {
      data: policy ? { ...SAFE_RECOMMENDATION_POLICY, shadowLogging: { ...SAFE_RECOMMENDATION_POLICY.shadowLogging, enabled: shadowEnabled } } : loadedData[key],
      isLoading: core ? coreLoading : !policy,
      isSuccess: core ? !coreLoading : policy,
      isError: false,
      error: null,
    };
  }) as typeof useQuery);
});

describe('player data loading boundaries', () => {
  it('passes dropped prediction rows into the existing visible readiness warning channel', () => {
    loadedData.predictions = { generatedAt: null, modelVersion: 'fixture', players: [],
      warnings: ['Dropped 1 invalid prediction row(s). players[1]: invalid position'] };
    render();
    expect(result.dataInfo.readinessWarnings.find(warning => warning.key === 'experimental-predictions')?.message)
      .toContain('Dropped 1 invalid prediction');
  });

  it.each([
    ['sleeper-adp', 'sleeper-player-directory', { players: [] }],
    ['team-environment', 'team-environment', { teams: {} }],
    ['contracts', 'contract-context', { players: [] }],
    ['sportsbook-snapshot', 'sportsbook-context', { metadata: {}, overUnder: [], milestones: [] }],
    ['fantasy-football-calculator-adp', 'market-adp', { players: [] }],
    ['league-survival-model', 'league-survival-model', { positions: {} }],
  ] as const)('shows %s decoder warnings in readiness', (query, key, data) => {
    draftState.connection = { provider: 'sleeper', draftId: 'test', draftPosition: 1, usePrimaryLeagueSettings: true };
    loadedData[query] = { ...data, [query === 'sportsbook-snapshot' ? 'decodeWarnings' : 'warnings']: ['Dropped 1 invalid optional rows.'] };
    render();
    expect(result.dataInfo.readinessWarnings).toContainEqual(expect.objectContaining({ key, message: 'Dropped 1 invalid optional rows.' }));
  });

  it('does not display sportsbook importer metadata as decoder warnings', () => {
    loadedData['sportsbook-snapshot'] = { metadata: {}, overUnder: [], milestones: [], warnings: ['importer note'] };
    render();
    expect(result.dataInfo.readinessWarnings).not.toContainEqual(expect.objectContaining({ key: 'sportsbook-context', message: 'importer note' }));
  });

  it('does not hold the core loading state open for pending optional queries', () => {
    render();
    expect(result.isLoading).toBe(false);
    coreLoading = true;
    render();
    expect(result.isLoading).toBe(true);
  });

  it.each([null, { provider: 'sleeper' as const, draftId: 'test', draftPosition: null }])(
    'clears cached shadow players when the confirmed draft position is lost: %s',
    (disconnected) => {
      const timestamp = new Date().toISOString();
      const season = 2026;
      shadowEnabled = true;
      draftState.connection = { provider: 'sleeper', draftId: 'test', draftPosition: 5 };
      loadedData = {
        'fantasypros-snapshot': {
          metadata: { season, refreshedAt: timestamp, sourceType: 'api' },
          rankings: [{ fantasyProsId: 'fp-1', rank: 1, name: 'Test Player', position: 'WR', team: 'DET', byeWeek: 8, positionalRank: 1 }],
          projections: [], news: [],
        },
        'player-identity': {
          season, generatedAt: timestamp,
          players: [{ canonicalId: 'player-1', fantasyProsId: 'fp-1', name: 'Test Player', aliases: [], position: 'WR', team: 'DET' }],
          coverage: { fantasyProsRankingMatchRate: 1, matchedDefenses: 32 },
        },
        'team-environment': { generatedAt: timestamp, teams: {} },
        predictions: {
          generatedAt: timestamp, modelVersion: 'test',
          players: Array.from({ length: 800 }, () => ({ playerId: 'player-1', name: 'Test Player', team: 'DET', position: 'WR', projectedPoints: 280, valueOverReplacement: 80, ceilingScore: 8, floorScore: 7, upsideScore: 8, uncertaintyScore: 2, injuryRiskScore: 2, predictionSource: 'model' })),
        },
      };
      render();
      expect(predictionEnabled).toBe(true);
      expect(result.shadowPlayers).toHaveLength(1);
      expect(result.dataInfo.shadowRecommendationAvailable).toBe(true);

      draftState.connection = disconnected;
      render();
      expect(predictionEnabled).toBe(false);
      expect(result.players).toHaveLength(1);
      expect(result.shadowPlayers).toEqual([]);
    }
  );

  it('loads predictions only for enabled shadow logging with confirmed connection and loaded core queries', () => {
    shadowEnabled = true;
    render();
    expect(predictionEnabled).toBe(false);
    draftState.connection = { provider: 'sleeper', draftId: 'test', draftPosition: null };
    render();
    expect(predictionEnabled).toBe(false);
    draftState.connection = { provider: 'sleeper', draftId: 'test', draftPosition: 5 };
    coreLoading = true;
    render();
    expect(predictionEnabled).toBe(false);
    coreLoading = false;
    render();
    expect(predictionEnabled).toBe(true);
    shadowEnabled = false;
    render();
    expect(predictionEnabled).toBe(false);
  });
});

afterEach(() => { vi.useRealTimers(); });

it.each([
  ['2027-02-28T23:59:59.999Z', 2026],
  ['2027-03-01T00:00:00.000Z', 2027],
])('uses the NFL season for live readiness and fallback ADP at %s', (timestamp, season) => {
  vi.setSystemTime(Date.parse(timestamp));
  loadedData['fantasypros-snapshot'] = { metadata: { season, refreshedAt: timestamp, sourceType: 'api' },
    rankings: Array.from({ length: 350 }, () => ({ name: 'Fixture', position: 'WR', team: 'DET', rank: 1 })), projections: [], news: [] };
  loadedData['player-identity'] = { season, generatedAt: timestamp, players: Array.from({ length: 800 }, () => ({ canonicalId: 'fixture', name: 'Fixture', position: 'WR', team: 'DET', aliases: [] })),
    coverage: { fantasyProsRankingMatchRate: 1, matchedDefenses: 32 } };
  loadedData['sportsbook-snapshot'] = { metadata: { season, capturedAt: timestamp }, overUnder: [{}], milestones: [{}] };
  render();
  expect.soft(result.dataInfo.readinessSources['trusted-rankings'].availability).toBe('available');
  expect.soft(result.dataInfo.readinessSources['canonical-player-identities'].availability).toBe('available');
  expect.soft(result.dataInfo.readinessSources['sportsbook-context'].availability).toBe('available');
  vi.mocked(useQuery).mockClear();
  delete loadedData['fantasypros-snapshot'];
  render();
  expect.soft(vi.mocked(useQuery).mock.calls.some(([options]) =>
    options.queryKey[0] === 'fantasy-football-calculator-adp' && options.queryKey[3] === season)).toBe(true);
});

it('uses the NFL season for the demo fallback while preserving an explicit bundled season', () => {
  draftState.demo = true;
  vi.setSystemTime(Date.parse('2027-02-28T23:59:59.999Z'));
  loadedData['player-identity'] = { season: 2026, generatedAt: '2027-02-28',
    players: Array.from({ length: 800 }, () => ({ canonicalId: 'fixture', name: 'Fixture', position: 'WR', team: 'DET', aliases: [] })),
    coverage: { fantasyProsRankingMatchRate: 1, matchedDefenses: 32 } };
  render();
  expect.soft(result.dataInfo.readinessSources['canonical-player-identities'].availability).toBe('available');
  loadedData['fantasypros-snapshot'] = { metadata: { season: 2026, refreshedAt: '2026-09-01', sourceType: 'fixture' },
    rankings: [], projections: [], news: [] };
  vi.setSystemTime(Date.parse('2030-09-01T00:00:00Z'));
  render();
  expect(result.dataInfo.readinessSources['canonical-player-identities'].availability).toBe('available');
});
