import * as React from 'react';

/**
 * Layout sizes that both CSS and TypeScript need (pool row and heading heights, the default board height) live in
 * one place: custom properties on :root in draft-design.css, including their laptop-height values. TypeScript
 * reads them here instead of repeating the numbers or the media queries that switch them.
 */
export const LAYOUT_TOKENS = {
  poolRowHeight: '--pool-row-height',
  poolHeadingHeight: '--pool-heading-height',
  boardDefaultHeight: '--board-default-height',
} as const;

export type LayoutToken = (typeof LAYOUT_TOKENS)[keyof typeof LAYOUT_TOKENS];

function measure(token: LayoutToken): number | null {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return null;
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Last measured value per token. Only the resize listener re-measures, so a render (the virtualized pool renders
 * on every scroll frame) reads a number instead of forcing a style recalculation. Values are cached only while a
 * subscriber keeps that listener attached, and dropped when the last one leaves, so a cached value is never stale.
 * A token that has no value yet (styles not loaded) is not cached, so the next read tries again.
 */
const cache = new Map<LayoutToken, number>();
/** Tokens read while subscribed, including ones that had no value yet, so a resize measures them all. */
const requested = new Set<LayoutToken>();
const listeners = new Set<() => void>();

function refresh(): void {
  let changed = false;
  for (const token of requested) {
    const value = measure(token);
    if (value === cache.get(token)) continue;
    if (value === null) {
      if (!cache.has(token)) continue;
      cache.delete(token);
    } else {
      cache.set(token, value);
    }
    changed = true;
  }
  if (changed) for (const listener of listeners) listener();
}

/** The token's current pixel value, or the fallback where styles are unavailable (tests, server render). */
export function readLayoutPx(token: LayoutToken, fallback: number): number {
  const cached = cache.get(token);
  if (cached !== undefined) return cached;
  if (listeners.size > 0) requested.add(token);
  const value = measure(token);
  if (value === null) return fallback;
  if (listeners.size > 0) cache.set(token, value);
  return value;
}

/** Window resizes are what switch the tokens' media-query values; one listener serves every subscriber. */
function subscribeToViewport(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('resize', refresh);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('resize', refresh);
      cache.clear();
      requested.clear();
    }
  };
}

/** Re-renders when a resize changes the token's value. */
export function useLayoutPx(token: LayoutToken, fallback: number): number {
  return React.useSyncExternalStore(
    subscribeToViewport,
    () => readLayoutPx(token, fallback),
    () => fallback
  );
}

/** Tests only: forget measured values. */
export function resetLayoutTokenCacheForTests(): void {
  cache.clear();
  requested.clear();
}
