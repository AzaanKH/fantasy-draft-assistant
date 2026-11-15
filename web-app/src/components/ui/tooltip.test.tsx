// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IconTooltip, TooltipProvider } from './tooltip';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

const tooltip = (): Element | null => document.querySelector('[data-slot="tooltip-content"]');

/** Each way a menu trigger hands focus to its menu; the menu then returns focus to the trigger. */
const opensMenu: Record<string, (trigger: HTMLButtonElement) => void> = {
  pointer: (trigger) => {
    // Radix menus open on pointerdown without focusing the trigger.
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  },
  keyboard: (trigger) => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    trigger.blur();
  },
  'focus leaving while expanded': (trigger) => {
    trigger.focus();
    trigger.setAttribute('aria-expanded', 'true');
    trigger.blur();
    trigger.setAttribute('aria-expanded', 'false');
  },
};

it.each(Object.keys(opensMenu))('does not reopen when a menu opened by %s returns focus, then shows on a later focus', (how) => {
  act(() => {
    root.render(createElement(TooltipProvider, { delayDuration: 0, children: createElement(IconTooltip, { label: 'Appearance', children: createElement('button', { type: 'button', 'aria-haspopup': 'menu' }, 'Theme') }) }));
  });
  const trigger = container.querySelector('button');
  if (!trigger) throw new Error('No trigger');
  act(() => { opensMenu[how]?.(trigger); });
  act(() => { trigger.focus(); });
  expect(tooltip()).toBeNull();

  act(() => { trigger.blur(); });
  act(() => { trigger.focus(); });
  expect(tooltip()?.textContent).toContain('Appearance');
});
