// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fullyVisibleItems, stickyHeaderRootMargin, useIdsInViewport, useInViewport } from './use-in-viewport';

type Callback = (entries: { target: Element; isIntersecting: boolean; intersectionRatio?: number }[]) => void;
const observers: { callback: Callback; targets: Element[]; options: IntersectionObserverInit | undefined }[] = [];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class {
    readonly record: { callback: Callback; targets: Element[]; options: IntersectionObserverInit | undefined };
    constructor(callback: Callback, options?: IntersectionObserverInit) { this.record = { callback, targets: [], options }; observers.push(this.record); }
    observe(target: Element) { this.record.targets.push(target); }
    disconnect() { this.record.targets = []; }
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); observers.length = 0; document.documentElement.style.removeProperty('--draft-header-height'); });

function report(visible: Record<string, boolean>): void {
  act(() => {
    for (const observer of observers) {
      observer.callback(observer.targets.map((target) => ({ target, isIntersecting: visible[target.getAttribute('data-id') ?? 'self'] ?? true })));
    }
  });
}

it('drops ids whose element scrolls out of view and restores them when it returns', () => {
  let visible: readonly string[] = [];
  function List(): React.ReactElement {
    const ref = useRef<HTMLUListElement>(null);
    visible = useIdsInViewport(ref, 'data-id', ['a', 'b']);
    return createElement('ul', { ref }, createElement('li', { 'data-id': 'a' }), createElement('li', { 'data-id': 'b' }));
  }
  act(() => { root.render(createElement(List)); });
  expect(visible).toEqual(['a', 'b']);
  report({ a: true, b: false });
  expect(visible).toEqual(['a']);
  report({ a: true, b: true });
  expect(visible).toEqual(['a', 'b']);
});

it('reports a single element on and off screen', () => {
  let onScreen = false;
  function Action(): React.ReactElement {
    const [ref, visible] = useInViewport<HTMLDivElement>();
    onScreen = visible;
    return createElement('div', { ref });
  }
  act(() => { root.render(createElement(Action)); });
  expect(onScreen).toBe(true);
  report({ self: false });
  expect(onScreen).toBe(false);
});

it('with fully, treats a partly visible control as off screen, so its failure goes to the workspace notice', () => {
  let onScreen = false;
  function Action(): React.ReactElement {
    const [ref, visible] = useInViewport<HTMLButtonElement>({ fully: true });
    onScreen = visible;
    return createElement('button', { ref });
  }
  act(() => { root.render(createElement(Action)); });
  const send = (isIntersecting: boolean, intersectionRatio: number): void => {
    act(() => { for (const observer of observers) observer.callback(observer.targets.map((target) => ({ target, isIntersecting, intersectionRatio }))); });
  };
  // R8-5: 23px of a growing wrapper showed while Retry had 0px; a sliver of the control itself is not enough either.
  send(true, 0.4);
  expect(onScreen).toBe(false);
  send(true, 1);
  expect(onScreen).toBe(true);
  send(false, 0);
  expect(onScreen).toBe(false);
});

it('counts a card only while its whole Draft/Retry control is below the sticky header (R9-2)', () => {
  document.documentElement.style.setProperty('--draft-header-height', '57px');
  let visible: readonly string[] = [];
  function Cards(): React.ReactElement {
    const ref = useRef<HTMLOListElement>(null);
    visible = useIdsInViewport(ref, 'data-id', ['a', 'b'], true, { fully: true, belowStickyHeader: true });
    return createElement('ol', { ref }, createElement('li', { 'data-id': 'a' }), createElement('li', { 'data-id': 'b' }));
  }
  act(() => { root.render(createElement(Cards)); });
  const current = observers.find((observer) => observer.targets.length > 0);
  // The header's height is removed from the top of the viewport the controls are measured against.
  expect(current?.options?.rootMargin).toBe('-57px 0px 0px 0px');
  expect(stickyHeaderRootMargin(56.4)).toBe('-57px 0px 0px 0px');
  // Card a's control still intersects the viewport, but only partly (the rest is behind the header): it no longer
  // reports its failure, so the workspace notice shows a reachable Retry instead.
  act(() => {
    current?.callback(current.targets.map((target) => ({ target, isIntersecting: true, intersectionRatio: target.getAttribute('data-id') === 'a' ? 0.3 : 1 })));
  });
  expect(visible).toEqual(['b']);
});

it('keeps only virtual rows wholly inside the scroller and below its sticky heading', () => {
  const rows = [{ start: 30, end: 70 }, { start: 70, end: 110 }, { start: 110, end: 150 }, { start: 150, end: 190 }];
  // Scrolled 20px with a 30px heading: row 1 starts under the heading, row 4 is cut at the bottom.
  expect(fullyVisibleItems(rows, { scrollOffset: 20, viewportHeight: 150, stickyTop: 30 })).toEqual([rows[1], rows[2]]);
});
