import * as React from 'react';

export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback((listener: () => void) => {
    const mediaQuery = window.matchMedia(query);
    mediaQuery.addEventListener('change', listener);
    return () => { mediaQuery.removeEventListener('change', listener); };
  }, [query]);
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
