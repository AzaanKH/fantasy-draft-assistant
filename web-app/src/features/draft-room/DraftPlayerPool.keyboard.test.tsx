// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { DraftPlayerPool } from './DraftPlayerPool';

const sync = vi.hoisted(() => ({ synchronizationState: 'idle' }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('./LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: { provider: 'sleeper' }, synchronizationState: sync.synchronizationState }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({ output: { selectedLens: 'best-pick' }, overall: { recommendations: [], rankByPlayerId: new Map() },
    readiness: null, recommendationsBlocked: false, nextPickAvailabilityById: new Map() }),
}));

let container: HTMLDivElement;
let root: Root;
let store: DraftStoreApi;
beforeEach(() => {
  sync.synchronizationState = 'idle';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout; give the scroller a size so the virtualizer renders rows.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  store = createDraftStore();
  store.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'snake' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function render(mode: 'mock' | 'live'): void {
  store.getState().setSessionMode(mode);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(DraftPlayerPool)) })); });
}
const search = () => container.querySelector<HTMLInputElement>('input.draft-search-input') ?? (() => { throw new Error('Missing search'); })();
const list = () => container.querySelector<HTMLElement>('.draft-pool-scroll') ?? (() => { throw new Error('Missing list'); })();
const activeName = () => container.querySelector('[data-player-row][data-active] .draft-pool-name')?.textContent;
function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}
const [first, second] = VISUAL_PLAYERS;

it('focuses search from / and Cmd+K, but never fires shortcuts while typing in another field', () => {
  render('mock');
  const other = document.createElement('input');
  container.append(other);
  other.focus();
  expect(press(other, '/').defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(other);

  act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  expect(press(document.body, '/').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(search());

  act(() => { search().blur(); });
  press(document.body, 'k', { metaKey: true });
  expect(document.activeElement).toBe(search());
  expect(search().getAttribute('aria-describedby')).toBe('draft-pool-shortcuts');
  expect(container.querySelector('#draft-pool-shortcuts')?.textContent).toContain('queue');
});

it('moves through results with arrows, queues with q, and drafts with Enter in a mock', () => {
  render('mock');
  act(() => { search().focus(); });
  // `q` typed into search is text, not a shortcut.
  press(search(), 'q');
  expect(store.getState().shortlistedPlayerIds).toEqual([]);

  press(search(), 'ArrowDown');
  expect(document.activeElement).toBe(list());
  expect(activeName()).toBe(first?.name);
  press(list(), 'ArrowDown');
  expect(activeName()).toBe(second?.name);

  press(list(), 'q');
  expect(store.getState().shortlistedPlayerIds).toEqual([second?.id]);

  press(list(), 'Enter');
  expect(store.getState().draftHistory.map(pick => pick.playerId)).toEqual([second?.id]);

  press(list(), 'Escape');
  expect(document.activeElement).toBe(search());
});

it('asks for confirmation through the Provisional Pick dialog instead of drafting in live Manual Continuity', () => {
  sync.synchronizationState = 'manual-continuity';
  render('live');
  act(() => { search().focus(); });
  press(search(), 'ArrowDown');
  expect(container.querySelector('#draft-pool-shortcuts')?.textContent).toContain('record pick');
  press(list(), 'Enter');
  expect(store.getState().draftHistory).toEqual([]);
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Record a Provisional Pick');
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="Observed player"]')?.value).toBe(first?.id);
});

function renderInert(onRevealRequest?: () => void): HTMLDivElement {
  store.getState().setSessionMode('live');
  const hidden = document.createElement('div');
  hidden.setAttribute('inert', '');
  container.append(hidden);
  const hiddenRoot = createRoot(hidden);
  act(() => { hiddenRoot.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(DraftPlayerPool, { onRevealRequest })) })); });
  return hidden;
}

it('leaves / alone while the dock is collapsed and cannot be revealed', () => {
  renderInert();
  expect(press(document.body, '/').defaultPrevented).toBe(false);
});

it('reveals a collapsed dock before focusing search', () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  const reveal = vi.fn();
  const hidden = renderInert(() => { reveal(); hidden.removeAttribute('inert'); });
  expect(press(document.body, '/').defaultPrevented).toBe(true);
  expect(reveal).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(hidden.querySelector('input.draft-search-input'));
});

it('only adds with Enter: a queued player stays queued and the hint says so', () => {
  render('live');
  act(() => { search().focus(); });
  press(search(), 'ArrowDown');
  expect(container.querySelector('#draft-pool-shortcuts')?.textContent).toContain('add to queue');
  press(list(), 'Enter');
  expect(store.getState().shortlistedPlayerIds).toEqual([first?.id]);
  press(list(), 'Enter');
  expect(store.getState().shortlistedPlayerIds).toEqual([first?.id]);
  expect(container.querySelector('#draft-pool-shortcuts')?.textContent).toContain('already queued');
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('already in your queue');
  // q stays the toggle.
  press(list(), 'q');
  expect(store.getState().shortlistedPlayerIds).toEqual([]);
});

it('points the grid\'s aria-activedescendant at the highlighted row\'s player cell and describes it once', () => {
  render('live');
  act(() => { search().focus(); });
  press(search(), 'ArrowDown');
  expect(list().getAttribute('role')).toBe('grid');
  const active = list().getAttribute('aria-activedescendant');
  expect(active).toBe(`draft-pool-row-${String(first?.id)}-player`);
  const cell = document.getElementById(active ?? '');
  expect(cell?.getAttribute('role')).toBe('gridcell');
  expect(cell?.closest('[role="row"]')?.id).toBe(`draft-pool-row-${String(first?.id)}`);
  // The keyboard hint, then the row's injury and risk detail when it has any (its chips have no tab stop of their own).
  const descriptions = (cell?.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '');
  expect(descriptions[0]).toMatch(/Not queued\. Enter: add to queue\./);
  expect(descriptions.filter((text) => /Not queued/.test(text))).toHaveLength(1);
  // Moving the highlight is read from the active cell, not repeated by the live region.
  expect(container.querySelector('p[aria-live="polite"]')?.textContent).toBe('');
});

it('disables every Draft button and ignores Enter while another pick is saving', async () => {
  const { getPickLock } = await import('@/workspace/pick-in-flight');
  const { workspaceForTestStore } = await import('@/workspace/workspace-test-helpers');
  render('mock');
  const lock = getPickLock(workspaceForTestStore(store));
  const pending = { playerId: 'elsewhere', playerName: 'Someone Else', origin: 'suggestion-card' };
  act(() => { expect(lock.begin(pending)).toBe(true); });

  const draftButtons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Draft "]')];
  expect(draftButtons.length).toBeGreaterThan(1);
  expect(draftButtons.every((button) => button.disabled)).toBe(true);
  expect(container.querySelector('.draft-pool-footer')?.textContent).toContain('Saving pick');

  act(() => { search().focus(); });
  press(search(), 'ArrowDown');
  press(list(), 'Enter');
  expect(store.getState().draftHistory).toEqual([]);

  act(() => { lock.settle(pending); });
  expect([...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Draft "]')].some((button) => !button.disabled)).toBe(true);
});

it('keeps Enter from queueing while a pick saves', async () => {
  const { getPickLock } = await import('@/workspace/pick-in-flight');
  const { workspaceForTestStore } = await import('@/workspace/workspace-test-helpers');
  render('mock');
  store.getState().setConfig({ myPickPosition: 1 });
  const lock = getPickLock(workspaceForTestStore(store));
  const pending = { playerId: 'elsewhere', playerName: 'Someone Else', origin: 'suggestion-card' };
  act(() => { lock.begin(pending); });
  act(() => { search().focus(); });
  press(search(), 'ArrowDown');
  press(list(), 'Enter');
  expect(store.getState().shortlistedPlayerIds).toEqual([]);
  expect(store.getState().draftHistory).toEqual([]);
  act(() => { lock.settle(pending); });
});

it('never acts on a held key: Enter, q and Enter-from-search ignore repeats, while arrows keep repeating', () => {
  render('mock');
  act(() => { search().focus(); });
  // One long press of Enter in search: the first event highlights, its repeats must not draft.
  press(search(), 'Enter');
  expect(activeName()).toBe(first?.name);
  expect(press(search(), 'Enter', { repeat: true }).defaultPrevented).toBe(true);
  press(search(), 'Enter', { repeat: true });
  expect(store.getState().draftHistory).toEqual([]);

  press(search(), 'ArrowDown');
  press(list(), 'ArrowDown', { repeat: true });
  expect(activeName()).toBe(second?.name);
  press(list(), 'q', { repeat: true });
  expect(store.getState().shortlistedPlayerIds).toEqual([]);
  press(list(), 'Enter', { repeat: true });
  expect(store.getState().draftHistory).toEqual([]);
  // A fresh press still works.
  press(list(), 'Enter');
  expect(store.getState().draftHistory.map((pick) => pick.playerId)).toEqual([second?.id]);
});
