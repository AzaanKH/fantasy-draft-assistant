import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageNavigation, URL_POLL_INTERVAL_MS, watchUrlChanges } from './url-change-watcher';

function timers() {
  return {
    setInterval: (callback: () => void, delay: number) => window.setInterval(callback, delay),
    clearInterval: (timer: number) => { window.clearInterval(timer); },
  };
}

describe('watchUrlChanges', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reports Navigation API entry changes immediately and stops listening when stopped', () => {
    const navigation = new EventTarget();
    const onChange = vi.fn();
    const stop = watchUrlChanges({ navigation, ...timers() }, onChange);

    navigation.dispatchEvent(new Event('currententrychange'));
    expect(onChange).toHaveBeenCalledOnce();

    stop();
    navigation.dispatchEvent(new Event('currententrychange'));
    vi.advanceTimersByTime(URL_POLL_INTERVAL_MS * 3);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('falls back to an interval check without the Navigation API', () => {
    const onChange = vi.fn();
    const stop = watchUrlChanges({ navigation: undefined, ...timers() }, onChange);

    vi.advanceTimersByTime(URL_POLL_INTERVAL_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledOnce();

    stop();
    vi.advanceTimersByTime(URL_POLL_INTERVAL_MS * 3);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('uses the window Navigation object only when the browser provides one', () => {
    const navigation = new EventTarget();
    expect(pageNavigation(Object.assign(Object.create(window) as Window, { navigation }))).toBe(navigation);
    expect(pageNavigation(Object.assign(Object.create(window) as Window, { navigation: undefined }))).toBeUndefined();
  });
});
