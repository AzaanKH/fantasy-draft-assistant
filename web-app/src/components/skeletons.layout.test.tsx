// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisualApp } from '@/visual/VisualApp';

/**
 * The loading state machine: while player data loads, each screen reports busy and loading, never paused advice.
 * The draft skeleton also keeps the loaded workspace's structure; the Assistant's skeleton geometry is measured by the
 * browser gate's cold-load check.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function renderVisual(url: string): HTMLElement {
  window.history.replaceState(null, '', url);
  // A new key remounts the fixture, which reads its route once.
  act(() => { root.render(createElement(VisualApp, { key: url })); });
  const screen = container.querySelector<HTMLElement>('[data-visual-screen]');
  if (!screen) throw new Error(`${url} rendered no visual screen`);
  return screen;
}

/** The given layout classes in document order, one entry per element that has any of them. */
function outline(element: HTMLElement, classes: readonly string[]): string[] {
  const selector = classes.map((name) => `.${name}`).join(',');
  return [...element.querySelectorAll(selector)].map((node) =>
    classes.filter((name) => node.classList.contains(name)).join(' '));
}

const DRAFT_LAYOUT = [
  'draft-workspace', 'draft-workspace-stack', 'draft-board', 'board-toolbar', 'board-scroll',
  'draft-best-pick-inline', 'draft-workspace-resizer', 'draft-dock', 'draft-dock-heading', 'draft-dock-tabs',
  'draft-dock-panel', 'draft-pool', 'player-pool-toolbar', 'draft-position-filters', 'draft-player-search',
  'draft-pool-scroll', 'draft-pool-table', 'draft-pool-heading', 'draft-pool-footer',
] as const;

describe('loading states', () => {
  it('renders the draft workspace itself, busy and loading rather than paused, while player data loads', () => {
    const loaded = renderVisual('/__visual/mobile/draft');
    const loadedOutline = outline(loaded, DRAFT_LAYOUT);
    const loadedColumns = loaded.querySelector('.draft-pool-heading .draft-pool-columns')?.children.length;
    expect(loadedColumns).toBeGreaterThan(0);

    const loading = renderVisual('/__visual/loading?state=draft');
    expect(loading.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
    expect(outline(loading, DRAFT_LAYOUT)).toEqual(loadedOutline);
    // Placeholder rows use the pool's own row grid, with one cell per column heading.
    const placeholderRows = [...loading.querySelectorAll('.draft-pool-row.draft-pool-columns')];
    expect(placeholderRows.length).toBeGreaterThan(0);
    for (const row of placeholderRows) expect(row.children).toHaveLength(loadedColumns ?? -1);
    expect(loading.querySelectorAll('[data-player-row]')).toHaveLength(0);
    expect(loading.querySelector('.draft-pool-footer')?.textContent).toContain('Loading players');
    // Readiness is blocked until data arrives; the workspace reports loading, not paused advice.
    expect(loading.querySelector('.draft-best-pick-inline')?.textContent).toContain('Finding your best pick');
    expect(loading.querySelector('.draft-pool-paused')).toBeNull();
    const suggestions = [...loading.querySelectorAll<HTMLElement>('[role=tab]')].find((tab) => tab.textContent.startsWith('Suggestions'));
    act(() => { suggestions?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
    expect(loading.querySelector('[role=tabpanel][data-state=active]')?.textContent).toContain('Loading suggestions');
  });

  it.each([
    ['/__visual/loading?state=assistant', 'true'],
    ['/__visual/assistant?state=wait', null],
  ] as const)('marks the Assistant at %s busy only while loading, with each selected tab pointing at a rendered panel', (url, busy) => {
    const screen = renderVisual(url);
    expect(screen.querySelector('.rec-workspace')?.getAttribute('aria-busy') ?? null).toBe(busy);
    const selected = [...screen.querySelectorAll('[role=tab][aria-selected=true]')];
    expect(selected.length).toBeGreaterThan(0);
    for (const tab of selected) {
      expect(screen.querySelector(`#${tab.getAttribute('aria-controls') ?? ''}`)).not.toBeNull();
    }
  });
});
