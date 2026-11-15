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

// Radix owns the menu's keyboard model; this checks only what the app adds: the checked current theme, the trigger's name and focus return.
it('checks the current theme, names the chosen one on the trigger, and returns focus to it', () => {
  act(() => { trigger().focus(); });
  key(trigger(), 'Enter');
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  expect(items.map(item => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

  key(items[0] as HTMLElement, 'ArrowDown');
  key(items[1] as HTMLElement, 'Enter');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(trigger().getAttribute('aria-label')).toBe('Appearance: dark');
  expect(document.activeElement).toBe(trigger());
});
