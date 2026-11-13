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

function render(): HTMLButtonElement {
  act(() => {
    root.render(createElement(TooltipProvider, { delayDuration: 0, children: createElement(IconTooltip, { label: 'Appearance', children: createElement('button', { type: 'button', 'aria-haspopup': 'menu' }, 'Theme') }) }));
  });
  const trigger = container.querySelector('button');
  if (!trigger) throw new Error('No trigger');
  return trigger;
}
const tooltip = (): Element | null => document.querySelector('[data-slot="tooltip-content"]');

it('does not reopen when a menu opened with the pointer returns focus to its trigger', () => {
  const trigger = render();
  // Radix menus open on pointerdown without focusing the trigger; closing the menu then focuses it.
  act(() => { trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
  act(() => { document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); });
  act(() => { trigger.focus(); });
  expect(tooltip()).toBeNull();
  // A later, ordinary keyboard focus still shows it.
  act(() => { trigger.blur(); });
  act(() => { trigger.focus(); });
  expect(tooltip()?.textContent).toContain('Appearance');
});

it('does not reopen after a menu opened from the keyboard returns focus', () => {
  const trigger = render();
  act(() => { trigger.focus(); });
  act(() => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  act(() => { trigger.blur(); });
  act(() => { trigger.focus(); });
  expect(tooltip()).toBeNull();
});
