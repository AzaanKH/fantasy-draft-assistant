// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deriveDraft, getRecommendationBoard } from '@fantasy-draft/shared/draft';
import { createDraftStore, DraftStoreProvider, type DraftStoreApi } from '@/stores/draftStore';
import { shadowPlayers } from '@/stores/draft/derive-shadow-catalog';
import { useRecommendations } from '@/hooks/useRecommendations';
import { getDraftView, useDraftView, useDraftViewReader } from './useDraftView';

vi.mock('@fantasy-draft/shared/draft', async importOriginal => {
  const actual = await importOriginal<typeof import('@fantasy-draft/shared/draft')>();
  return { ...actual, deriveDraft: vi.fn(actual.deriveDraft), getRecommendationBoard: vi.fn(actual.getRecommendationBoard) };
});
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: shadowPlayers, isLoading: false }) }));
vi.mock('@/hooks/useLeagueTimingEvidence', () => ({ useLeagueTimingEvidence: () => ({ model: null, isLoading: false }) }));
let store: DraftStoreApi;
let root: Root;
let container: HTMLDivElement;
let read: ReturnType<typeof useDraftViewReader>;
function Readers() {
  const currentPick = useDraftView(view => view.currentPick);
  const available = useDraftView(view => view.available);
  const roster = useDraftView(view => view.myRoster);
  const teams = useDraftView(view => view.teamRosters);
  const queue = useDraftView(view => view.shortlistedPlayerIds);
  read = useDraftViewReader();
  const recommendations = useRecommendations();
  return createElement('output', null, `${currentPick}:${available.length}:${roster.QB.length}:${teams.length}:${queue.length}:${recommendations.bestAvailable.length}`);
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  store = createDraftStore(); store.getState().setSessionMode('mock');
  container = document.createElement('div'); root = createRoot(container);
  act(() => { root.render(createElement(DraftStoreProvider, { store, children: createElement(Readers) })); });
});
afterEach(() => { act(() => { root.unmount(); }); });
it('shares the projection and recommendation board across unrelated UI and clock updates', () => {
  const before = read(); const derives = vi.mocked(deriveDraft).mock.calls.length;
  const boards = vi.mocked(getRecommendationBoard).mock.calls.length;
  act(() => { store.getState().setSearchQuery('receiver'); store.getState().setMockSettingsOpen(true); store.getState().setPositionFilter('WR'); });
  expect(read()).toBe(before); expect(getDraftView(store, shadowPlayers)).toBe(before);
  expect(vi.mocked(deriveDraft).mock.calls.length).toBe(derives);
  expect(vi.mocked(getRecommendationBoard).mock.calls.length).toBe(boards);
  act(() => { root.render(createElement(DraftStoreProvider, { store, children: createElement(Readers) })); });
  expect(read()).toBe(before); expect(vi.mocked(deriveDraft).mock.calls.length).toBe(derives);
  expect(vi.mocked(getRecommendationBoard).mock.calls.length).toBe(boards);
});
it('derives once per source transition through a complete 140-pick mock', () => {
  const counts: number[] = [];
  for (let index = 0; index < 140; index += 1) {
    const player = shadowPlayers[index]; if (!player) throw new Error('Missing player');
    const before = vi.mocked(deriveDraft).mock.calls.length;
    act(() => { store.getState().markPlayerDrafted(player.id, player.name, player.position, index % 10, `Team ${String(index % 10 + 1)}`, index + 1, 'cpu'); });
    expect(read().currentPick).toBe(index + 2);
    expect(read().available).toHaveLength(599 - index);
    counts.push(vi.mocked(deriveDraft).mock.calls.length - before);
  }
  expect(counts).toEqual(Array.from({ length: 140 }, () => 1));
  expect(container.textContent).toContain('141:460:');
});
it('keeps separate stores and catalog replacements isolated', () => {
  const other = createDraftStore(); const before = read();
  other.getState().branchFromPick(96);
  expect(getDraftView(other, shadowPlayers).currentPick).toBe(96); expect(read()).toBe(before);
  const replacement = shadowPlayers.slice(0, 20);
  expect(getDraftView(store, replacement).available).toHaveLength(20);
  expect(read().available).toHaveLength(600);
});
