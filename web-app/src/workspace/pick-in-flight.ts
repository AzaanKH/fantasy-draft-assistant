import * as React from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { useContentVisible } from '@/lib/content-visibility';
import { useWorkspace } from './WorkspaceProvider';
import type { DraftState } from '@/stores/draft/types';
import type { Workspace } from './workspace';

/**
 * One pick save at a time per workspace. While a Draft (mock) or Record (Provisional Pick) save is pending,
 * every Draft/Record control is disabled and keyboard drafting is ignored, so a second click on another row,
 * a suggestion card or the pool's Enter key cannot race the first save.
 *
 * `origin` names the control that started the save, so only that control shows its pending or failed state:
 * the failure has one primary surface instead of one per subscriber.
 */
export interface PickInFlight {
  readonly playerId: string;
  readonly playerName: string;
  readonly origin: string;
  /** Starts the same save again; the workspace notice offers it once the originating control is gone. */
  readonly retry?: () => void;
}

/** A save that has not settled by then releases the lock as a failure, so a hung write cannot block every pick. */
export const PICK_SAVE_TIMEOUT_MS = 15_000;

/** A control that renders a failure for `playerId` (or for any player, when omitted) started from `origin`. */
export function reporterKey(origin: string, playerId?: string): string {
  return playerId === undefined ? `${origin}\u0000*` : `${origin}\u0000${playerId}`;
}

export interface PickFailure extends PickInFlight {
  readonly message: string;
}

export interface PickLockState {
  readonly inFlight: PickInFlight | null;
  readonly failure: PickFailure | null;
  /**
   * Controls that are rendered and can show a failure, as `reporterKey`s. A failure no rendered control reports
   * (its control unmounted, or its player left the cards) falls back to the workspace notice.
   */
  readonly reporters: ReadonlySet<string>;
}

export interface PickLock {
  readonly store: StoreApi<PickLockState>;
  /** Takes the lock; false when another pick is already saving. */
  begin(pick: PickInFlight): boolean;
  /**
   * Releases the lock held by this exact attempt (the object passed to `begin`); a failure is kept for its origin to
   * show. A late answer from an attempt the timeout already released never settles a newer attempt, such as its retry.
   */
  settle(pick: PickInFlight, failureMessage?: string): void;
  isLocked(): boolean;
  /**
   * Marks a rendered control as showing failures from `origin` for these players (any player when omitted); the
   * returned function unmarks it.
   */
  mountReporter(origin: string, playerIds?: readonly string[]): () => void;
  /** The failure was acknowledged. */
  dismissFailure(): void;
  /**
   * Wraps a retry so it does nothing once the draft context it was created in has gone (another session, mode,
   * disconnect or reset): a retry kept by a closed dialog must not record its old replacement into a new draft.
   */
  bindRetry(retry: () => void): () => void;
  /** The current draft context; it changes whenever bindRetry's retries go stale. */
  context(): number;
  /** Called after the draft context changes; returns the unsubscribe. */
  onContextChange(listener: () => void): () => void;
  /**
   * The draft was restarted. Releases a pending save and drops its failure, even for a draft that had no picks yet
   * (an empty draft reset to empty looks unchanged to the store subscription).
   */
  reset(): void;
}

/**
 * The draft facts a failure was about. When any of them changes (a pick lands, undo, reset, a new mock, another
 * session or mode) the failure is stale: retrying it would act on a different draft state, so it is dropped.
 */
function pickContextChanged(previous: DraftState, next: DraftState): boolean {
  // Compared by value: a durable save of anything (a queue edit, say) republishes equal objects for the same facts.
  const changed = (before: unknown, after: unknown): boolean => before !== after && JSON.stringify(before) !== JSON.stringify(after);
  return changed(previous.draftHistory, next.draftHistory)
    || changed(previous.draftProgress, next.draftProgress)
    || previous.sessionMode !== next.sessionMode
    || changed(previous.liveSession, next.liveSession);
}

/**
 * The draft itself changed (another session or mode, a disconnect, or a reset), not just its next pick. A save still
 * pending from the old draft is released: its late answer, timeout or retry must not show up while the new one is
 * active. A pick landing or an undo stays the same draft, so the pending save keeps the lock.
 */
function draftIdentityChanged(previous: DraftState, next: DraftState): boolean {
  // Compared by value: a storage publication rebuilds these objects for the same draft, which is not a switch.
  const sameSession = previous.liveSession?.provider === next.liveSession?.provider
    && previous.liveSession?.draftId === next.liveSession?.draftId;
  // A reset empties a draft that had picks back to its start.
  const reset = previous.draftHistory.length > 0 && next.draftHistory.length === 0
    && next.draftProgress.anchor.kind === 'start' && next.draftProgress.historyLength === 0;
  return previous.sessionMode !== next.sessionMode || !sameSession || reset;
}

// Keyed by the draft store, which is stable for a workspace even when wrappers recreate the workspace object.
const locks = new WeakMap<object, PickLock>();

export function getPickLock(workspace: Pick<Workspace, 'draft'>): PickLock {
  const existing = locks.get(workspace.draft);
  if (existing) return existing;
  const store = createStore<PickLockState>(() => ({ inFlight: null, failure: null, reporters: new Set<string>() }));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
  };
  // Bumped whenever the draft identity changes; an attempt or retry from an older context is stale.
  let context = 0;
  const listeners = new Set<() => void>();
  const changeContext = (): void => {
    context += 1;
    clearTimer();
    if (store.getState().inFlight || store.getState().failure) store.setState({ inFlight: null, failure: null });
    for (const listener of [...listeners]) listener();
  };
  // Lives as long as the draft store (the WeakMap key), so it is never unsubscribed separately.
  workspace.draft.subscribe((next, previous) => {
    if (draftIdentityChanged(previous, next)) {
      changeContext();
      return;
    }
    if (store.getState().failure && pickContextChanged(previous, next)) store.setState({ failure: null });
  });
  const lock: PickLock = {
    store,
    begin(pick) {
      if (store.getState().inFlight) return false;
      store.setState({ inFlight: pick, failure: null });
      clearTimer();
      timeout = setTimeout(() => {
        lock.settle(pick, `${pick.playerName} may not have been saved. The save did not finish within ${String(PICK_SAVE_TIMEOUT_MS / 1000)} seconds. Check the board, then retry.`);
      }, PICK_SAVE_TIMEOUT_MS);
      return true;
    },
    settle(pick, failureMessage) {
      const { inFlight } = store.getState();
      // A save that settles after its timeout already released the lock is ignored here, even when its retry (same
      // origin and player) now holds the lock; if it did land, the draft state changed and the failure is dropped.
      if (inFlight !== pick) return;
      clearTimer();
      store.setState({ inFlight: null, failure: failureMessage === undefined ? null : { ...inFlight, message: failureMessage } });
    },
    isLocked: () => store.getState().inFlight !== null,
    mountReporter(origin, playerIds) {
      const keys = playerIds === undefined ? [reporterKey(origin)] : playerIds.map((playerId) => reporterKey(origin, playerId));
      store.setState((state) => {
        const reporters = new Set(state.reporters);
        for (const key of keys) reporters.add(key);
        return { reporters };
      });
      return () => {
        store.setState((state) => {
          const reporters = new Set(state.reporters);
          for (const key of keys) reporters.delete(key);
          return { reporters };
        });
      };
    },
    dismissFailure() {
      store.setState({ failure: null });
    },
    bindRetry(retry) {
      const created = context;
      return () => { if (created === context) retry(); };
    },
    context: () => context,
    onContextChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reset: changeContext,
  };
  locks.set(workspace.draft, lock);
  return lock;
}

export function usePickLock(): PickLock {
  const workspace = useWorkspace();
  return getPickLock(workspace);
}

/** The pick currently saving anywhere in this workspace, or null. */
export function usePickInFlight(): PickInFlight | null {
  const lock = usePickLock();
  return useStore(lock.store, (state) => state.inFlight);
}

/** A stable id for one control (or hook instance) that can start a pick. */
export function usePickOrigin(): string {
  return React.useId();
}

/**
 * Registers a control as showing failures from `origin` (for `playerIds` only, when given) while it is actually
 * visible: a collapsed or inert wrapper (ContentVisibility) unregisters it, so its failures reach the workspace notice
 * instead of a control nobody can see. Keyed by content, so a new array with the same players does not re-register.
 */
export function usePickFailureReporter(lock: PickLock, origin: string, playerIds: readonly string[] | undefined, enabled = true): void {
  const visible = useContentVisible();
  const key = playerIds === undefined ? null : playerIds.join('\u0000');
  React.useEffect(() => {
    if (!enabled || !visible) return;
    return lock.mountReporter(origin, key === null ? undefined : key === '' ? [] : key.split('\u0000'));
  }, [enabled, key, lock, origin, visible]);
}

/** True when a rendered control shows this failure itself. */
export function isPickFailureReported(state: Pick<PickLockState, 'reporters'>, failure: PickFailure): boolean {
  return state.reporters.has(reporterKey(failure.origin)) || state.reporters.has(reporterKey(failure.origin, failure.playerId));
}

/**
 * A failed pick no rendered control shows: its control unmounted (the user navigated away or closed the dialog
 * while it saved), or the player is no longer among the cards that control renders.
 */
export function useOrphanedPickFailure(): PickFailure | null {
  const lock = usePickLock();
  return useStore(lock.store, (state) => state.failure && !isPickFailureReported(state, state.failure) ? state.failure : null);
}
