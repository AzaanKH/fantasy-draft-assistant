// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readLayoutPx, resetLayoutTokenCacheForTests, useLayoutPx } from './layout-tokens';

const root = document.documentElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { resetLayoutTokenCacheForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); root.style.removeProperty('--pool-row-height'); });

it('measures a token once while subscribed and serves later renders (every scroll frame) from the cache', () => {
  root.style.setProperty('--pool-row-height', '44px');
  let renders = 0;
  function Probe() { renders += 1; useLayoutPx('--pool-row-height', 40); return null; }
  const reactRoot = createRoot(document.createElement('div'));
  act(() => { reactRoot.render(createElement(Probe)); });
  const styles = vi.spyOn(window, 'getComputedStyle');
  for (let frame = 0; frame < 20; frame += 1) act(() => { reactRoot.render(createElement(Probe)); });
  expect(renders).toBeGreaterThan(20);
  expect(styles).not.toHaveBeenCalled();
  act(() => { reactRoot.unmount(); });
});

it('drops the cache when the last subscriber leaves, so a later mount never reads a stale value', () => {
  root.style.setProperty('--pool-row-height', '44px');
  function Probe() { useLayoutPx('--pool-row-height', 40); return null; }
  const reactRoot = createRoot(document.createElement('div'));
  act(() => { reactRoot.render(createElement(Probe)); });
  act(() => { reactRoot.unmount(); });
  // Changed while nothing listened for resizes.
  root.style.setProperty('--pool-row-height', '36px');
  expect(readLayoutPx('--pool-row-height', 40)).toBe(36);
});

it('re-measures only on resize, and re-renders subscribers when the value changed', () => {
  root.style.setProperty('--pool-row-height', '44px');
  const seen: number[] = [];
  function Probe() { seen.push(useLayoutPx('--pool-row-height', 40)); return null; }
  const container = document.createElement('div');
  const reactRoot = createRoot(container);
  act(() => { reactRoot.render(createElement(Probe)); });
  root.style.setProperty('--pool-row-height', '36px');
  expect(readLayoutPx('--pool-row-height', 40)).toBe(44);
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(seen.at(-1)).toBe(36);
  const renders = seen.length;
  // A resize that leaves the value alone does not re-render.
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(seen.length).toBe(renders);
  act(() => { reactRoot.unmount(); });
});

it('does not cache a missing value, so styles that load later are picked up', () => {
  expect(readLayoutPx('--pool-row-height', 40)).toBe(40);
  root.style.setProperty('--pool-row-height', '44px');
  expect(readLayoutPx('--pool-row-height', 40)).toBe(44);
});
