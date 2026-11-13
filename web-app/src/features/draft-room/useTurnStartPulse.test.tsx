// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTurnStartPulse } from './useTurnStartPulse';

let container: HTMLDivElement;
let root: Root;
const animate = vi.fn(() => ({ cancel: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  HTMLElement.prototype.animate = animate as never;
  animate.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

function Banner({ turn }: { readonly turn: number | null }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useTurnStartPulse(ref, turn);
  return createElement('div', { ref });
}

it('pulses for each new turn, including back-to-back picks at the snake turnaround, never on mount', () => {
  act(() => { root.render(createElement(Banner, { turn: null })); });
  act(() => { root.render(createElement(Banner, { turn: 12 })); });
  expect(animate).toHaveBeenCalledTimes(1);
  act(() => { root.render(createElement(Banner, { turn: 13 })); });
  expect(animate).toHaveBeenCalledTimes(2);
  act(() => { root.render(createElement(Banner, { turn: 13 })); });
  act(() => { root.render(createElement(Banner, { turn: null })); });
  expect(animate).toHaveBeenCalledTimes(2);
});
