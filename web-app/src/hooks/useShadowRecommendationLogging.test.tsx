// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { decodeShadowRecommendationEvent } from '@fantasy-draft/shared/catalog';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { createDraftStore } from '@/stores/draftStore';
import { VISUAL_PLAYER_DATA, VISUAL_PLAYERS } from '@/visual/VisualApp';
import { WorkspaceProvider } from '@/workspace/WorkspaceProvider';
import { workspaceForTestStore } from '@/workspace/workspace-test-helpers';
import { useShadowRecommendationLogging } from './useShadowRecommendationLogging';

const DEPENDENCIES = {
  rankingsRefreshedAt: '2026-09-05T15:53:00.000Z',
  identitiesGeneratedAt: '2026-09-05T15:53:00.000Z',
  teamEnvironmentGeneratedAt: null,
};

// The draft-day shape: predictions built at 15:17Z, then the preflight refreshed rankings and identities at 15:53Z.
const playerData = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => playerData.value }));
vi.mock('./useLeagueTimingEvidence', () => ({ useLeagueTimingEvidence: () => ({ model: null, warnings: [] }) }));

afterEach(() => { vi.unstubAllGlobals(); });

function recommendation(index: number): Recommendation {
  const player = VISUAL_PLAYERS[index];
  if (!player) throw new Error('Missing visual player');
  return { playerId: player.id, playerName: player.name, position: player.position, reason: 'Core policy', score: 10 - index };
}

it('posts exactly one Shadow Recommendation for an on-clock turn when predictions are older than their dependencies', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  playerData.value = {
    ...VISUAL_PLAYER_DATA,
    shadowPlayers: VISUAL_PLAYERS,
    dataInfo: {
      ...VISUAL_PLAYER_DATA.dataInfo,
      predictionModelVersion: 'position-ridge-v4',
      predictionGeneratedAt: '2026-09-05T15:17:00.000Z',
      shadowRecommendationAvailable: false,
      shadowLoggingEnabled: true,
      shadowLoggingSeason: 2026,
      shadowLoggingEndpoint: '/api/shadow-recommendations',
      predictionFreshness: 'older-than-dependency',
      predictionDependencies: DEPENDENCIES,
    },
  };
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
    const event = JSON.parse(init.body) as { eventId: string };
    bodies.push(event);
    return Response.json({ eventId: event.eventId, recorded: true }, { status: 201 });
  }));

  const store = createDraftStore();
  store.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'snake' });
  const core = [recommendation(0), recommendation(1)];
  function Observer() {
    useShadowRecommendationLogging({
      draftId: 'draft-day',
      draftProvider: 'sleeper',
      draftReady: true,
      coreBestPick: core[0] ?? null,
      coreBestPlayer: core[1] ?? null,
      coreRecommendations: core,
      corePolicy: 'primary-league-policy',
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const render = () => { root.render(createElement(WorkspaceProvider, { workspace: workspaceForTestStore(store), children: createElement(Observer) })); };

  await act(async () => { render(); await new Promise(resolve => setTimeout(resolve, 0)); });
  // A re-render on the same pick must not log the turn again.
  await act(async () => { render(); await new Promise(resolve => setTimeout(resolve, 0)); });
  act(() => { root.unmount(); });

  expect(bodies).toHaveLength(1);
  const event = decodeShadowRecommendationEvent(bodies[0]);
  expect(event.eventId).toBe('2026:sleeper:draft-day:1');
  expect(event.experiment).toEqual({
    sourceLabel: 'Experimental prediction artifact',
    modelVersion: 'position-ridge-v4',
    generatedAt: '2026-09-05T15:17:00.000Z',
    freshness: 'older-than-dependency',
    dependencies: DEPENDENCIES,
  });
});
