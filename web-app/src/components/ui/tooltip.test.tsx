// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

const content = (): Element | null => document.querySelector('[data-slot="tooltip-content"]');

it('does not reopen when focus returns from the menu its trigger opened, and never takes pointer events', () => {
  act(() => {
    root.render(createElement(TooltipProvider, { delayDuration: 0, children: createElement(Tooltip, { children: [
      createElement(TooltipTrigger, { key: 'trigger', asChild: true, children: createElement('button', { type: 'button', 'aria-expanded': 'false' }, 'Appearance') }),
      createElement(TooltipContent, { key: 'content' }, 'Appearance'),
    ] }) }));
  });
  const button = container.querySelector('button');
  if (!button) throw new Error('No trigger');
  act(() => { button.focus(); });
  expect(content()?.className).toContain('pointer-events-none');

  // The menu opens and takes focus, then closes and hands it back.
  button.setAttribute('aria-expanded', 'true');
  act(() => { button.blur(); });
  button.setAttribute('aria-expanded', 'false');
  act(() => { button.focus(); });
  expect(content()).toBeNull();

  // An ordinary later focus still shows the tooltip.
  act(() => { button.blur(); });
  act(() => { button.focus(); });
  expect(content()).not.toBeNull();
});
