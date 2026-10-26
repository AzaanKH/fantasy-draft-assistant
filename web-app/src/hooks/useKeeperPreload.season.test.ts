import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
type DraftStoreState = ReturnType<ReturnType<typeof createDraftStore>['getState']>;
import { useKeeperPreload } from './useKeeperPreload';

let state: DraftStoreState;
vi.mock('@/workspace/WorkspaceProvider', () => ({ useDraftState: (select: (value: DraftStoreState) => unknown) => select(state), useWorkspace: () => ({}) }));

const fixture = vi.hoisted(() => ({ season: 2026 }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({
  data: { season: fixture.season, updatedAt: '2026-09-01', keepers: [] },
  isLoading: false, isError: false, error: null,
}) }));
afterEach(() => { vi.useRealTimers(); });

it.each([
  ['2027-02-28T23:59:59.999Z', 2026],
  ['2027-03-01T00:00:00.000Z', 2027],
])('accepts confirmed keeper supply for the NFL season at %s', (timestamp, season) => {
  vi.useFakeTimers({ now: Date.parse(timestamp) });
  fixture.season = season;
  const store = createDraftStore();
  state = { ...store.getState(), config: { ...store.getState().config, totalTeams: 0 }, keepersInitialized: true, preloadedKeepers: [] };
  let ready = false;
  function Probe() { ready = useKeeperPreload([], false).isMockReady; return null; }
  renderToStaticMarkup(createElement(Probe));
  expect(ready).toBe(true);
});
