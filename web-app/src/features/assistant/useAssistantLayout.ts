import * as React from 'react';


const RECOMMENDATION_GRID_MEDIA_QUERIES = {
  medium: '(min-width: 48rem)',
  large: '(min-width: 64rem)',
  extraLarge: '(min-width: 80rem)',
  twoExtraLarge: '(min-width: 96rem)',
} as const;

export function getCollapsedPlayerCount(): number {
  if (typeof window === 'undefined') return 3;
  if (document.documentElement.hasAttribute('data-visual-test')) return 10;
  if (window.matchMedia(RECOMMENDATION_GRID_MEDIA_QUERIES.twoExtraLarge).matches) return 5;
  if (window.matchMedia(RECOMMENDATION_GRID_MEDIA_QUERIES.extraLarge).matches) return 4;
  return 3;
}

export function subscribeToRecommendationGrid(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const mediaQueries = Object.values(RECOMMENDATION_GRID_MEDIA_QUERIES)
    .map((query) => window.matchMedia(query));
  mediaQueries.forEach((query) => { query.addEventListener('change', listener); });

  return () => {
    mediaQueries.forEach((query) => { query.removeEventListener('change', listener); });
  };
}

export function useCollapsedPlayerCount(): number {
  return React.useSyncExternalStore(
    subscribeToRecommendationGrid,
    getCollapsedPlayerCount,
    () => 3
  );
}

export function getUsesDesktopPlayerPool(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia(RECOMMENDATION_GRID_MEDIA_QUERIES.large).matches;
}

export function useUsesDesktopPlayerPool(): boolean {
  return React.useSyncExternalStore(
    subscribeToRecommendationGrid,
    getUsesDesktopPlayerPool,
    () => false
  );
}

