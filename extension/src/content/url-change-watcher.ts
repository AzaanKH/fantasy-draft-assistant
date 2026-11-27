/** The slice of the Navigation API the watcher uses; absent in browsers without it. */
export interface NavigationEvents {
  addEventListener(type: 'currententrychange', listener: () => void): void;
  removeEventListener(type: 'currententrychange', listener: () => void): void;
}

/** `window.navigation` when the browser has the Navigation API; TypeScript's DOM types do not declare it yet. */
export function pageNavigation(target: Window): NavigationEvents | undefined {
  const value: unknown = Reflect.get(target, 'navigation');
  return value instanceof EventTarget ? value : undefined;
}

export interface UrlChangeWatcherEnvironment {
  readonly navigation: NavigationEvents | undefined;
  readonly setInterval: (callback: () => void, delay: number) => number;
  readonly clearInterval: (timer: number) => void;
}

/** A fallback check of location.href: one string comparison, unlike a subtree MutationObserver on a busy page. */
export const URL_POLL_INTERVAL_MS = 1000;

/**
 * Calls `onChange` when the page may have navigated. The Navigation API reports
 * SPA history changes (pushState, replaceState, back/forward) as they happen; the
 * interval check covers any change it misses. Callers compare the URL themselves.
 * Returns a function that stops watching.
 */
export function watchUrlChanges(
  environment: UrlChangeWatcherEnvironment,
  onChange: () => void
): () => void {
  const listener = () => { onChange(); };
  environment.navigation?.addEventListener('currententrychange', listener);
  const timer = environment.setInterval(listener, URL_POLL_INTERVAL_MS);
  return () => {
    environment.navigation?.removeEventListener('currententrychange', listener);
    environment.clearInterval(timer);
  };
}
