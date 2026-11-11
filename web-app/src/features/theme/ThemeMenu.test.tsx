// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeMenu } from './ThemeMenu';
import { ThemeProvider } from './ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => { root.render(createElement(TooltipProvider, null, createElement(ThemeProvider, { initialTheme: 'light', persist: false, children: createElement(ThemeMenu) }))); });
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function trigger(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label^="Appearance"]');
  if (!button) throw new Error('Missing trigger');
  return button;
}
function key(target: Element, name: string): void {
  // Radix roving focus moves focus on a timer; fake timers flush it without
  // letting the popper's real animation-frame loop stall the runner.
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    vi.runOnlyPendingTimers();
  });
  // Focus restoration is scheduled while the closed menu unmounts.
  act(() => { vi.runOnlyPendingTimers(); });
}

// One open per test: Radix popper content is CPU-heavy to tear down under jsdom (~6s per open).
it('opens from the keyboard, moves with arrows, selects with Enter, and returns focus to the trigger', () => {
  act(() => { trigger().focus(); });
  key(trigger(), 'Enter');
  const menu = document.querySelector('[role="menu"]');
  expect(menu?.getAttribute('aria-label')).toBe('Choose appearance');
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  expect(items.map(item => item.textContent)).toEqual(['Light', 'Dark', 'System']);
  expect(items.map(item => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

  // Enter opens with the first item focused; arrows rove.
  expect(document.activeElement).toBe(items[0]);
  key(items[0] as HTMLElement, 'ArrowDown');
  expect(document.activeElement).toBe(items[1]);
  key(items[1] as HTMLElement, 'ArrowUp');
  expect(document.activeElement).toBe(items[0]);
  key(items[0] as HTMLElement, 'ArrowDown');

  key(items[1] as HTMLElement, 'Enter');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(trigger().getAttribute('aria-label')).toBe('Appearance: dark');
  expect(document.activeElement).toBe(trigger());
});
