// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { DraftBoard } from './DraftBoard';

vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const store = createDraftStore();
  store.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 2, draftType: 'snake' });
  store.getState().setSessionMode('mock');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(DraftBoard) })); });
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

it('exposes the board as a table whose team and round headers frame each pick cell', () => {
  const table = container.querySelector('.board-grid');
  expect(table?.getAttribute('role')).toBe('table');
  expect(table?.getAttribute('aria-colcount')).toBe('5');
  expect(table?.getAttribute('aria-rowcount')).toBe('4');

  const rows = [...(table?.children ?? [])];
  expect(rows.every(row => row.getAttribute('role') === 'row')).toBe(true);
  const [header, ...rounds] = rows;
  const headers = [...(header?.children ?? [])];
  expect(headers.map(cell => cell.getAttribute('role'))).toEqual(['columnheader', 'columnheader', 'columnheader', 'columnheader', 'columnheader']);
  expect(headers[2]?.textContent).toContain('My Team');

  for (const [index, row] of rounds.entries()) {
    const cells = [...row.children];
    expect(row.getAttribute('aria-rowindex')).toBe(String(Number(cells[0]?.getAttribute('aria-label')?.replace('Round ', '')) + 1));
    expect(cells[0]?.getAttribute('role')).toBe('rowheader');
    expect(cells.slice(1).map(cell => cell.getAttribute('role'))).toEqual(['cell', 'cell', 'cell', 'cell']);
    expect(cells.slice(1).every(cell => cell.classList.contains('board-slot') && cell.getAttribute('aria-label')?.startsWith('Pick '))).toBe(true);
    expect(index).toBeLessThan(3);
  }
  // Rows only group cells for assistive tech; they must not become grid items.
  expect(rows.every(row => row.classList.contains('contents'))).toBe(true);
});

it('stops following the live pick when the user scrolls it away, even right after an automatic scroll', () => {
  // jsdom has no layout: give the board a size so Full mode scrolls to the live pick, which starts the smooth-scroll window.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  const fullBoard = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Full board'));
  act(() => { fullBoard?.click(); });
  const jump = () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('Jump to live pick'));
  expect(jump()).toBeUndefined();

  const scroller = container.querySelector<HTMLElement>('.board-scroll');
  if (!scroller) throw new Error('Missing board scroller');
  // jsdom rects are all zero, so the live slot sits under the sticky header: out of view.
  act(() => { scroller.dispatchEvent(new Event('wheel')); scroller.dispatchEvent(new Event('scroll')); });
  expect(jump()).toBeDefined();

  act(() => { jump()?.click(); });
  expect(jump()).toBeUndefined();
  vi.restoreAllMocks();
});

it('pauses Current pick on a deliberate scroll-away, like Full board, and keeps the pause through a resize', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  const scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  const jump = () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('Jump to live pick'));
  const view = (label: string) => [...container.querySelectorAll('button')].find(button => button.textContent.includes(label));
  // Re-enter Current pick so its listeners attach with the mocked size.
  act(() => { view('Full board')?.click(); });
  act(() => { view('Current pick')?.click(); });
  const scroller = container.querySelector<HTMLElement>('.board-scroll');
  if (!scroller) throw new Error('Missing board scroller');
  // jsdom rects are all zero, so the live slot reads as out of view.
  act(() => { scroller.dispatchEvent(new Event('wheel')); scroller.dispatchEvent(new Event('scroll')); });
  expect(jump()).toBeDefined();
  // A scroll the board's resize causes (its size changed) is the layout's, not the user's: the pause stays.
  scrollTo.mockClear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700);
  act(() => { scroller.dispatchEvent(new Event('scroll')); });
  expect(jump()).toBeDefined();
  expect(scrollTo).not.toHaveBeenCalled();
  act(() => { jump()?.click(); });
  expect(jump()).toBeUndefined();
  vi.restoreAllMocks();
});

it('ignores its own smooth scroll until scrollend, then follows the user again', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  const fullBoard = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Full board'));
  const scrollerBefore = container.querySelector<HTMLElement>('.board-scroll');
  if (!scrollerBefore) throw new Error('Missing board scroller');
  act(() => { fullBoard?.click(); });
  const scroller = container.querySelector<HTMLElement>('.board-scroll');
  if (!scroller) throw new Error('Missing board scroller');
  const jump = () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('Jump to live pick'));
  // Start away from the live pick so "Jump to live pick" issues a real programmatic scroll.
  act(() => { scroller.dispatchEvent(new Event('wheel')); scroller.scrollTop = 600; scroller.dispatchEvent(new Event('scroll')); });
  expect(jump()).toBeDefined();
  act(() => { jump()?.click(); });
  expect(jump()).toBeUndefined();

  // Scroll events from that smooth scroll do not count as the user leaving the live pick.
  act(() => { scroller.dispatchEvent(new Event('scroll')); });
  expect(jump()).toBeUndefined();
  // Once it settles, the next scroll is the user's again.
  act(() => { scroller.dispatchEvent(new Event('scrollend')); scroller.dispatchEvent(new Event('scroll')); });
  expect(jump()).toBeDefined();
  vi.restoreAllMocks();
});

it('does not announce the board current-pick chip; the turn banner owns turn announcements', () => {
  const chip = container.querySelector('.board-current-pick');
  expect(chip).not.toBeNull();
  expect(chip?.getAttribute('role')).toBeNull();
  expect(chip?.closest('[aria-live], [role="status"]')).toBeNull();
});

it('renders a single current-pick grid', () => {
  expect(container.querySelectorAll('.board-scroll')).toHaveLength(1);
});
