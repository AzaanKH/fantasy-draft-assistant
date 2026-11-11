// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { PositionTiersView } from './PositionTiersView';
import { createAssistantTestData, withAssistantData } from './assistant-data-test-helpers';

let container: HTMLDivElement;
let root: Root;
/** The sheet's content width; the scroller is always 600px wide. */
let contentWidth = 600;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  contentWidth = 600;
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => contentWidth);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => {
    root.render(createElement(TooltipProvider, { children: withAssistantData(createAssistantTestData({ players: VISUAL_PLAYERS, draftedPlayerIds: new Set<string>() }), createElement(PositionTiersView, { selectedPlayerId: undefined, onSelect: vi.fn() })) }));
  });
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const search = (): HTMLInputElement => container.querySelector<HTMLInputElement>('.rec-search input') ?? (() => { throw new Error('No tier search'); })();
function type(value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search(), value);
    search().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('clears the tier search with its clear button and with Escape, like the card search', () => {
  type('zzz');
  const clear = container.querySelector<HTMLButtonElement>('button[aria-label="Clear tier search"]');
  expect(clear).not.toBeNull();
  act(() => { clear?.click(); });
  expect(search().value).toBe('');
  expect(container.querySelector('button[aria-label="Clear tier search"]')).toBeNull();

  type('zzz');
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => { search().dispatchEvent(escape); });
  expect(escape.defaultPrevented).toBe(true);
  expect(search().value).toBe('');
});

it('puts the More columns control in the toolbar and re-measures when the content changes, not only on resize', () => {
  expect(container.querySelector('[data-tier-scroll-cue]')).toBeNull();
  // Show drafted (or a filter or search) widens the sheet without resizing its scroller.
  contentWidth = 1200;
  act(() => { container.querySelector<HTMLInputElement>('.rec-checkbox input')?.click(); });
  const more = container.querySelector('[data-tier-scroll-cue][data-side="end"]');
  expect(more?.closest('.rec-pool-toolbar')).not.toBeNull();
  expect(more?.closest('.rec-tier-scroll')).toBeNull();
  contentWidth = 600;
  type('a');
  expect(container.querySelector('[data-tier-scroll-cue]')).toBeNull();
});

it('focuses the tier search with /, but never from a text field', () => {
  const slash = (): KeyboardEvent => new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
  const fromPage = slash();
  act(() => { document.body.dispatchEvent(fromPage); });
  expect(fromPage.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(search());

  const other = document.createElement('input');
  document.body.append(other);
  other.focus();
  const fromField = slash();
  act(() => { other.dispatchEvent(fromField); });
  expect(fromField.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(other);
  other.remove();
});

it('says a fully drafted position is drafted out and offers Show drafted, instead of "No matching players"', () => {
  const position = VISUAL_PLAYERS[0]?.position ?? 'WR';
  const drafted = new Set(VISUAL_PLAYERS.filter((player) => player.position === position).map((player) => player.id));
  act(() => {
    root.render(createElement(TooltipProvider, { children: withAssistantData(createAssistantTestData({ players: VISUAL_PLAYERS, draftedPlayerIds: drafted }), createElement(PositionTiersView, { selectedPlayerId: undefined, onSelect: vi.fn() })) }));
  });
  const filter = [...container.querySelectorAll<HTMLButtonElement>('.rec-filters button')].find((button) => button.textContent.startsWith(position));
  act(() => { filter?.click(); });
  const empty = container.querySelector('[data-tiers-drafted-out]');
  expect(empty?.textContent).toContain(`drafted`);
  expect(container.textContent).not.toContain('No matching players');
  const show = [...(empty?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Show drafted');
  act(() => { show?.click(); });
  expect(container.querySelector('[data-tiers-drafted-out]')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('.rec-checkbox input')?.checked).toBe(true);
});

it('labels tier numbers as the source ranking, not the model rank', () => {
  expect(container.querySelector('.rec-tier-colhead-rank')?.textContent).toBe('ECR');
  const rank = container.querySelector('.rec-tier-row .rec-candidate-rank');
  expect(rank?.querySelector('.sr-only')?.textContent).toMatch(/^Expert rank \d+$/);
  expect(rank?.hasAttribute('aria-label')).toBe(false);
});

it('tells a search that only matches drafted players so, and offers Show drafted', () => {
  const target = VISUAL_PLAYERS.find((player) => player.position !== 'K' && player.position !== 'DEF');
  if (!target) throw new Error('No offensive fixture');
  act(() => {
    root.render(createElement(TooltipProvider, { children: withAssistantData(
      createAssistantTestData({ players: VISUAL_PLAYERS, draftedPlayerIds: new Set([target.id]) }),
      createElement(PositionTiersView, { selectedPlayerId: undefined, onSelect: vi.fn() })) }));
  });
  type(target.name);
  const notice = container.querySelector('[data-tiers-drafted-match]');
  expect(notice?.getAttribute('role')).toBe('status');
  expect(notice?.textContent).toContain('has been drafted');
  act(() => { notice?.querySelector('button')?.click(); });
  expect(container.querySelector(`[data-tier-player-id="${target.id}"]`)).not.toBeNull();
});

it('says Final on every row and leaves the % header empty on the final pick', () => {
  act(() => {
    root.render(createElement(TooltipProvider, { children: withAssistantData(
      createAssistantTestData({ players: VISUAL_PLAYERS, nextPickLabel: null }),
      createElement(PositionTiersView, { selectedPlayerId: undefined, onSelect: vi.fn() })) }));
  });
  expect(container.querySelector('.rec-tier-colhead-value')?.textContent).toBe('');
  const values = [...container.querySelectorAll('.rec-tier-row .rec-tier-missing')].map((cell) => cell.textContent);
  expect(values.length).toBeGreaterThan(0);
  expect(new Set(values)).toEqual(new Set(['Final']));
});
