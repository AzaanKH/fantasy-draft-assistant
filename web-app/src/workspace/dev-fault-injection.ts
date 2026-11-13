/**
 * Development builds only: the browser gate fails or hangs the next save on demand.
 * - `window.__draftFailNextPickSave = true` fails the next Draft save.
 * - `window.__draftHangNextPickSave = true` makes the next Draft save never settle, so its 15-second timeout runs.
 * - `window.__draftHangNextQueueSave = true` does the same for the next queue save.
 * Quick Mock picks are memory-only, so no storage fault can reach them; this is the one way to exercise a real failed
 * or hung save, its Retry and the workspace notice in a browser. Production builds drop the branch
 * (import.meta.env.DEV is false).
 */
type FaultFlag = '__draftFailNextPickSave' | '__draftHangNextPickSave' | '__draftHangNextQueueSave';

function takeFlag(flag: FaultFlag): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const target = window as unknown as Partial<Record<FaultFlag, boolean>>;
  if (target[flag] !== true) return false;
  target[flag] = false;
  return true;
}

export function takeInjectedPickFailure(): Error | null {
  return takeFlag('__draftFailNextPickSave') ? new Error('The pick could not be saved (development fault injection).') : null;
}

/** A save that never settles, when the gate asked for one; null otherwise. */
export function takeInjectedHang(kind: 'pick' | 'queue'): Promise<never> | null {
  return takeFlag(kind === 'pick' ? '__draftHangNextPickSave' : '__draftHangNextQueueSave') ? new Promise<never>(() => {}) : null;
}
