import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { LivePlayerDataProvider, usePlayerDataQuery, type PlayerDataQueryResult } from './usePlayerData';
import type { PersistedDraftSyncConnection } from '@/stores/draftSyncStore';
import { SAFE_RECOMMENDATION_POLICY } from '@/lib/player-data/policy';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
const draftState = vi.hoisted(() => ({ connection: null as PersistedDraftSyncConnection | null }));
vi.mock('@/stores/draftSyncStore', () => ({
  useDraftSyncConnectionStore: (selector: (state: typeof draftState) => unknown) => selector(draftState),
}));

let loadedData: Record<string, unknown> = {};
let coreLoading = false;
let shadowEnabled = false;
let predictionEnabled: unknown;
let result: PlayerDataQueryResult;
function Probe() { result = usePlayerDataQuery(); return null; }
function render() { renderToStaticMarkup(createElement(LivePlayerDataProvider, null, createElement(Probe))); }

beforeEach(() => {
  loadedData = {};
  coreLoading = false;
  shadowEnabled = false;
  predictionEnabled = undefined;
  draftState.connection = null;
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
      const season = new Date().getFullYear();
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
