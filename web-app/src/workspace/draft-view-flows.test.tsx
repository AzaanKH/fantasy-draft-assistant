// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftStore, DraftStoreProvider, type DraftStoreApi } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DraftBoard } from '@/features/draft-room/DraftBoard';
import { DraftPlayerPool } from '@/features/draft-room/DraftPlayerPool';
import { DraftQueuePanel } from '@/features/draft-room/DraftQueuePanel';
import { DraftRosterPanel } from '@/features/draft-room/DraftRosterPanel';

const players = VISUAL_PLAYERS;
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players, isLoading: false }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({
    output: { selectedLens: 'best-pick' }, overall: { recommendations: [] },
    readiness: { blockers: [] }, recommendationsBlocked: false,
  }),
}));
let container: HTMLDivElement;
let root: Root;
let store: DraftStoreApi;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  store = createDraftStore();
  store.getState().setConfig({ myPickPosition: 1 });
  store.getState().setSessionMode('mock');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });
function render() {
  act(() => { root.render(createElement(DraftStoreProvider, { store, children:
    createElement(TooltipProvider, null, createElement(Fragment, null,
      createElement(DraftBoard), createElement(DraftPlayerPool), createElement(DraftRosterPanel), createElement(DraftQueuePanel))) })); });
}
function status() { return container.querySelector('.board-current-pick')?.textContent; }
function poolCount() { return Number(container.querySelector('[role="table"][aria-rowcount]')?.getAttribute('aria-rowcount')) - 1; }
function firstPlayer() { const player = players[0]; if (!player) throw new Error('Missing fixture'); return player; }
it('renders the manager on the clock and complete browse pool beyond recommendations', () => {
  store.getState().togglePlayerShortlisted(firstPlayer().id);
  render(); expect(status()).toContain('Your turn'); expect(poolCount()).toBe(players.length);
  const button = container.querySelector<HTMLButtonElement>('.draft-queue-row .draft-pill-action');
  expect(button?.disabled).toBe(false);
  act(() => { button?.click(); });
  expect(status()).toContain('1.02'); expect(poolCount()).toBe(players.length - 1);
});
it('renders keeper pause, consume and undo without allowing the reserved slot', () => {
  const player = firstPlayer();
  store.getState().preloadKeepers([{ playerId: player.id, playerName: player.name, position: player.position, teamIndex: 0, round: 1, isMyKeeper: true }]);
  render(); expect(status()).toContain('Keeper'); expect(poolCount()).toBe(players.length - 1);
  act(() => { store.getState().consumeKeeperAtCurrentPick(); }); expect(status()).toContain('1.02');
  act(() => { store.getState().undoLastPick(); }); expect(status()).toContain('Keeper'); expect(poolCount()).toBe(players.length - 1);
});
it('renders a branch at 96 with an empty history', () => {
  store.getState().branchFromPick(96); render(); expect(status()).toContain('10.06');
});
it('renders a sparse provider cursor even below recorded history', () => {
  const player = firstPlayer(); store.getState().setSessionMode('live');
  store.getState().reconcileSyncedPicks([{ pickNumber: 20, playerId: player.id, playerName: player.name, position: player.position, teamIndex: 0, teamName: 'Team 1', isMyPick: true }], 4);
  render(); expect(status()).toContain('1.04'); expect(poolCount()).toBe(players.length - 1);
});
it('renders a live outage observation and provider correction', () => {
  const player = firstPlayer(); const replacement = players[1]; if (!replacement) throw new Error('Missing replacement');
  store.getState().setSessionMode('live'); store.getState().reconcileSyncedPicks([], 1);
  store.getState().enterManualContinuity(1000); render();
  act(() => { expect(store.getState().recordProvisionalPick({ pickNumber: 1, playerId: player.id, playerName: player.name, position: player.position, teamIndex: 0, teamName: 'My Team' })).toBe(true); });
  expect(poolCount()).toBe(players.length - 1); expect(status()).toContain('1.02'); expect(container.textContent).toContain(player.name);
  act(() => { store.getState().reconcileSyncedPicks([{ pickNumber: 1, playerId: replacement.id, playerName: replacement.name, position: replacement.position, teamIndex: 0, teamName: 'My Team', isMyPick: true }], 2); });
  expect(poolCount()).toBe(players.length - 1); expect(container.querySelector('.draft-roster')?.textContent ?? container.textContent).toContain(replacement.name);
});
it('renders persisted reload with the retained branch cursor and membership', () => {
  const data = new Map<string, string>(); const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null };
  const session = { provider: 'sleeper' as const, draftId: 'render-reload' };
  const writer = createDraftStore({ storage, session }); const player = firstPlayer();
  writer.getState().markPlayerDrafted(player.id, player.name, player.position, 0, 'My Team'); writer.getState().branchFromPick(96);
  store = createDraftStore({ storage, session }); render(); expect(status()).toContain('10.06'); expect(poolCount()).toBe(players.length - 1);
});
