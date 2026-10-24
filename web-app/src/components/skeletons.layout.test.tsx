// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisualApp } from '@/visual/VisualApp';

/**
 * Loading states render the real layout. Each test lists the layout elements of a loaded screen and its
 * loading state, in document order, and expects the same structure.
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

const ASSISTANT_LAYOUT = [
  'rec-workspace', 'rec-context', 'rec-context-pick', 'rec-context-status', 'rec-lens', 'rec-view-tabs',
  'rec-layout', 'rec-main', 'rec-card', 'rec-card-identity', 'rec-card-avatar', 'rec-metrics', 'rec-actions',
  'rec-analysis', 'rec-answer', 'rec-rail', 'rec-rail-section',
] as const;

describe('loading states share the loaded layout', () => {
  it('renders the draft workspace itself while player data loads', () => {
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
    expect(loading.querySelectorAll('[data-player-row]')).toHaveLength(0);
    for (const row of placeholderRows) expect(row.children).toHaveLength(loadedColumns ?? -1);
    expect(loading.querySelector('.draft-pool-footer')?.textContent).toContain('Loading players');
  });

  it('builds the Assistant loading state from the page layout', () => {
    const loaded = outline(renderVisual('/__visual/assistant?state=wait'), ASSISTANT_LAYOUT);
    const loading = renderVisual('/__visual/loading?state=assistant');
    expect(loading.querySelector('.rec-workspace')?.getAttribute('aria-busy')).toBe('true');
    expect(outline(loading, ASSISTANT_LAYOUT)).toEqual(loaded);
    expect([...loading.querySelectorAll('.rec-tabs [role=tab]')].map((tab) => tab.textContent)).toEqual([
      'Suggestions', 'Position tiers', 'Why this player?', 'Compare options', 'Can I wait?', 'What does my roster need?',
    ]);
  });
});
