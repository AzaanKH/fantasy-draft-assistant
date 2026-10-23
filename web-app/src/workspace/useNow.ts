import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
export const readNow = (): number => now;

export function subscribeNow(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { clearInterval(timer); timer = undefined; }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribeNow, readNow, readNow);
}
