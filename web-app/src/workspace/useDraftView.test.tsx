// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deriveDraft, getRecommendationBoard } from '@fantasy-draft/shared/draft';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { draftPlayers } from '@/stores/draft/draft-catalog';
import { useRecommendations } from '@/hooks/useRecommendations';
import { useNow } from './useNow';
import { useWorkspace } from './WorkspaceProvider';
import { getDraftView, useDraftView, useDraftViewReader } from './useDraftView';

vi.mock('@fantasy-draft/shared/draft', async importOriginal => {
  const actual = await importOriginal<typeof import('@fantasy-draft/shared/draft')>();
  return { ...actual, deriveDraft: vi.fn(actual.deriveDraft), getRecommendationBoard: vi.fn(actual.getRecommendationBoard) };
});
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: draftPlayers, isLoading: false }) }));
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
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(Readers) })); });
});
afterEach(() => { act(() => { root.unmount(); }); });
it('shares the projection and recommendation board across unrelated UI and clock updates', () => {
  const before = read(); const derives = vi.mocked(deriveDraft).mock.calls.length;
  const boards = vi.mocked(getRecommendationBoard).mock.calls.length;
  act(() => { store.getState().setSearchQuery('receiver'); store.getState().setMockSettingsOpen(true); store.getState().setPositionFilter('WR'); });
  expect(read()).toBe(before); expect(getDraftView(store, draftPlayers)).toBe(before);
  expect(vi.mocked(deriveDraft).mock.calls.length).toBe(derives);
  expect(vi.mocked(getRecommendationBoard).mock.calls.length).toBe(boards);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(Readers) })); });
  expect(read()).toBe(before); expect(vi.mocked(deriveDraft).mock.calls.length).toBe(derives);
  expect(vi.mocked(getRecommendationBoard).mock.calls.length).toBe(boards);
});
it('derives one complete browse view per source transition through a 140-pick mock', () => {
  const counts: number[] = [];
  for (let index = 0; index < 140; index += 1) {
    const player = draftPlayers[index]; if (!player) throw new Error('Missing player');
    const before = vi.mocked(deriveDraft).mock.calls.length;
    act(() => { store.getState().markPlayerDrafted(player.id, player.name, player.position, index % 10, `Team ${String(index % 10 + 1)}`, index + 1, 'cpu'); });
    expect(read().currentPick).toBe(index + 2);
    expect(read().available).toHaveLength(599 - index);
    const calls = vi.mocked(deriveDraft).mock.calls.slice(before);
    counts.push(calls.filter(([, , players]) => players === draftPlayers).length);
  }
  expect(counts).toEqual(Array.from({ length: 140 }, () => 1));
  expect(container.textContent).toContain('141:460:');
});
it('keeps separate stores and catalog replacements isolated', () => {
  const other = createDraftStore(); const before = read();
  other.getState().branchFromPick(96);
  expect(getDraftView(other, draftPlayers).currentPick).toBe(96); expect(read()).toBe(before);
  const replacement = draftPlayers.slice(0, 20);
  expect(getDraftView(store, replacement).available).toHaveLength(20);
  expect(read().available).toHaveLength(600);
});

it('ticks an age display without rendering the command owner or deriving recommendations', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  let ownerRenders = 0;
  let readerRenders = 0;
  let commandOwner: ReturnType<typeof useWorkspace> | undefined;
  function Clock() { return createElement('time', null, useNow()); }
  function Owner() {
    commandOwner = useWorkspace(); ownerRenders += 1;
    return createElement(Clock);
  }
  function Board() { readerRenders += 1; return createElement(Readers); }
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: [createElement(Owner, {key: 'owner'}), createElement(Board, {key: 'board'})] })); });
  const view = read();
  const before = { ownerRenders, readerRenders, derives: vi.mocked(deriveDraft).mock.calls.length, boards: vi.mocked(getRecommendationBoard).mock.calls.length };
  const owner = commandOwner;
  const time = container.querySelector('time')?.textContent;
  act(() => { vi.advanceTimersByTime(5_000); });
  expect(container.querySelector('time')?.textContent).not.toBe(time);
  expect({ ownerRenders, readerRenders, derives: vi.mocked(deriveDraft).mock.calls.length, boards: vi.mocked(getRecommendationBoard).mock.calls.length }).toEqual(before);
  expect(commandOwner).toBe(owner);
  expect(read()).toBe(view);
  act(() => { root.unmount(); });
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(container);
  vi.useRealTimers();
});
