// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoardFollowLive } from './useBoardFollowLive';

let container: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[] = [];
let resize: (() => void) | null = null;
const size = { width: 0, height: 0, scrollWidth: 0 };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  Object.assign(size, { width: 0, height: 0, scrollWidth: 0 });
  frames = [];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

function flushFrames(): void {
  for (let index = 0; index < 10 && frames.length > 0; index += 1) {
    const pending = frames; frames = [];
    act(() => { for (const frame of pending) frame(0); });
  }
}

it('counts scrolls again after a resize settles on a board that is not laid out (zero size)', () => {
  let follow = true;
  function Board(): React.ReactElement {
    const board = useRef<HTMLDivElement | null>(null);
    const slot = useRef<HTMLDivElement | null>(null);
    follow = useBoardFollowLive({ mode: 'current', current: { board, slot }, full: { board, slot }, livePick: 5, layoutKey: 'a' }).followLive;
    return createElement('div', {
      ref: (element: HTMLDivElement | null) => {
        board.current = element;
        if (!element) return;
        Object.defineProperties(element, {
          clientWidth: { configurable: true, get: () => size.width },
          clientHeight: { configurable: true, get: () => size.height },
          scrollWidth: { configurable: true, get: () => size.scrollWidth },
        });
        element.scrollTo = () => undefined;
        element.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 300, right: 500, width: 500, height: 300 }) as DOMRect;
      },
    }, createElement('div', {
      ref: (element: HTMLDivElement | null) => {
        slot.current = element;
        // Far below and right of the visible area: scrolled out of view.
        if (element) element.getBoundingClientRect = () => ({ top: 900, left: 900, bottom: 940, right: 1000, width: 100, height: 40 }) as DOMRect;
      },
    }));
  }
  act(() => { root.render(createElement(Board)); });
  const board = container.firstElementChild as HTMLDivElement;

  // The dock changes layout: the grid's size changes while the board itself has no size yet.
  size.scrollWidth = 800;
  act(() => { resize?.(); });
  flushFrames();

  // Laid out again, the user scrolls the live pick away (a scrollbar drag: no wheel or pointer event on the board).
  Object.assign(size, { width: 500, height: 300 });
  act(() => { board.dispatchEvent(new Event('scroll')); });
  act(() => { board.dispatchEvent(new Event('scroll')); });
  expect(follow).toBe(false);
});
