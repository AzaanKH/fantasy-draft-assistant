// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { getPickLock, PICK_SAVE_TIMEOUT_MS } from './pick-in-flight';
import { sendWorkspaceCommand } from './workspace-command';
import { PickFailureNotice } from './PickFailureNotice';
import { workspaceForTestStore, WorkspaceTestProvider } from './workspace-test-helpers';

vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: [], isLoading: false }) }));

const pick = { playerId: 'p1', playerName: 'Player One', origin: 'origin-a' };

function fail(store: DraftStoreApi, origin = pick.origin): void {
  const lock = getPickLock(workspaceForTestStore(store));
  const attempt = { ...pick, origin };
  expect(lock.begin(attempt)).toBe(true);
  lock.settle(attempt, 'Player One was not drafted. Network down.');
}

describe('pick failures go stale with the draft state', () => {
  it('drops a failure when the pick, mode or session changes, not only on the next save', () => {
    const store = createDraftStore();
    const lock = getPickLock(workspaceForTestStore(store));

    fail(store);
    expect(lock.store.getState().failure?.message).toContain('Network down');
    // A pick lands (or undo/reset rewrites the history).
    act(() => { store.setState({ draftHistory: [...store.getState().draftHistory] }); });
    expect(lock.store.getState().failure).toBeNull();

    fail(store);
    act(() => { store.setState({ sessionMode: store.getState().sessionMode === 'mock' ? 'setup' : 'mock' }); });
    expect(lock.store.getState().failure).toBeNull();
  });

  it('keeps the failure through unrelated changes such as the queue', () => {
    const store = createDraftStore();
    const lock = getPickLock(workspaceForTestStore(store));
    fail(store);
    act(() => { store.setState({ shortlistedPlayerIds: ['p9'] }); });
    expect(lock.store.getState().failure).not.toBeNull();
  });
});

describe('PickFailureNotice', () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: DraftStoreApi;
  /** A Draft control: registers its origin on mount, like the real cards, pool rows and analysis action. */
  function DraftControl(): ReactElement {
    useDraftPlayerAction();
    return createElement('span', null, 'control');
  }
  const mountedOrigin = (): string => {
    const [key] = getPickLock(workspaceForTestStore(store)).store.getState().reporters;
    const origin = key?.split('\u0000')[0];
    if (!origin) throw new Error('No mounted origin');
    return origin;
  };

  function render(showControl: boolean): void {
    act(() => {
      root.render(createElement(WorkspaceTestProvider, { store, children: [
        showControl ? createElement(DraftControl, { key: 'control' }) : null,
        createElement(PickFailureNotice, { key: 'notice' }),
      ] }));
    });
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    store = createDraftStore();
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('stays hidden while the originating control shows the failure itself', () => {
    render(true);
    act(() => { fail(store, mountedOrigin()); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a failure whose control unmounted, and keeps it until dismissed', () => {
    render(true);
    const origin = mountedOrigin();
    const lock = getPickLock(workspaceForTestStore(store));
    const attempt = { ...pick, origin };
    expect(lock.begin(attempt)).toBe(true);
    // The user leaves the page that started the save; then the save fails.
    render(false);
    act(() => { lock.settle(attempt, 'Player One was not drafted. Network down.'); });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Player One was not drafted. Network down.');

    const dismiss = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Dismiss');
    act(() => { dismiss?.click(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(lock.store.getState().failure).toBeNull();
  });
});

describe('a failure follows the control that actually renders its player', () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: DraftStoreApi;
  /** The suggestion cards: one hook, reporting only for the players it renders. */
  function Cards({ ids }: { readonly ids: readonly string[] }): ReactElement {
    useDraftPlayerAction(ids);
    return createElement('span', null, ids.join(','));
  }
  function render(ids: readonly string[]): void {
    act(() => {
      root.render(createElement(WorkspaceTestProvider, { store, children: [
        createElement(Cards, { key: 'cards', ids }),
        createElement(PickFailureNotice, { key: 'notice' }),
      ] }));
    });
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    store = createDraftStore();
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('falls back to the notice when the drafted player leaves the cards (a lens change) before the save fails', () => {
    render(['p1', 'p2']);
    const lock = getPickLock(workspaceForTestStore(store));
    const [key] = lock.store.getState().reporters;
    const origin = key?.split('\u0000')[0] ?? '';
    const attempt = { ...pick, origin };
    expect(lock.begin(attempt)).toBe(true);
    // The lens changes: p1 is no longer among the four cards, but the hook stays mounted.
    render(['p3', 'p4']);
    act(() => { lock.settle(attempt, 'Player One was not drafted. Network down.'); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Player One was not drafted. Network down.');

    // Back among the cards, the card shows it again and the notice steps aside.
    render(['p1', 'p3']);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('a save that never settles', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('releases the lock as a failure after the safety timeout, ignores the late result, and offers Retry', () => {
    const store = createDraftStore();
    const lock = getPickLock(workspaceForTestStore(store));
    const retry = vi.fn();
    const original = { ...pick, retry };
    expect(lock.begin(original)).toBe(true);
    act(() => { vi.advanceTimersByTime(PICK_SAVE_TIMEOUT_MS - 1); });
    expect(lock.isLocked()).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(lock.isLocked()).toBe(false);
    expect(lock.store.getState().failure?.message).toContain(`did not finish within ${String(PICK_SAVE_TIMEOUT_MS / 1000)} seconds`);

    // The hung save finally answers: the timeout already released the lock, so nothing changes.
    lock.settle(original);
    expect(lock.store.getState().failure).not.toBeNull();
    // Its retry (same origin and player) takes the lock; the original's late answer must not release the retry.
    const retried = { ...pick, retry };
    expect(lock.begin(retried)).toBe(true);
    lock.settle(original, 'late failure from the first attempt');
    expect(lock.isLocked()).toBe(true);
    expect(lock.store.getState().failure).toBeNull();
    lock.settle(retried);
    expect(lock.isLocked()).toBe(false);

    // No control reports this origin, so the workspace notice shows the timeout with Retry.
    lock.begin({ ...pick, retry });
    act(() => { vi.advanceTimersByTime(PICK_SAVE_TIMEOUT_MS); });
    act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(PickFailureNotice) })); });
    const retryButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry');
    expect(retryButton).toBeDefined();
    act(() => { retryButton?.click(); });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(lock.store.getState().failure).toBeNull();
  });

  it('clears the timer when the save settles in time', () => {
    const store = createDraftStore();
    const lock = getPickLock(workspaceForTestStore(store));
    lock.begin(pick);
    lock.settle(pick);
    act(() => { vi.advanceTimersByTime(PICK_SAVE_TIMEOUT_MS * 2); });
    expect(lock.store.getState().failure).toBeNull();
  });
});

describe('a pending save from an old draft context', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const contextChanges = [
    ['disconnect', (store: DraftStoreApi) => { store.setState({ liveSession: null }); }],
    ['reset', (store: DraftStoreApi) => {
      store.setState({ draftHistory: [{ pickNumber: 1, playerId: 'p9', playerName: 'Nine', position: 'WR', teamIndex: 0, teamName: 'Team 1', timestamp: 0, source: 'manual' }] });
      store.getState().resetDraft();
    }],
    ['session change', (store: DraftStoreApi) => { store.setState({ liveSession: { provider: 'sleeper', draftId: 'draft-b' } }); }],
    ['mode change', (store: DraftStoreApi) => { store.setState({ sessionMode: store.getState().sessionMode === 'mock' ? 'setup' : 'mock' }); }],
  ] as const;

  function startInDraftA(): { store: DraftStoreApi; lock: ReturnType<typeof getPickLock>; attempt: typeof pick & { retry: () => void }; retry: ReturnType<typeof vi.fn> } {
    const store = createDraftStore();
    act(() => { store.setState({ liveSession: { provider: 'sleeper', draftId: 'draft-a' } }); });
    const lock = getPickLock(workspaceForTestStore(store));
    const retry = vi.fn();
    const attempt = { ...pick, retry: lock.bindRetry(retry) };
    expect(lock.begin(attempt)).toBe(true);
    return { store, lock, attempt, retry };
  }

  it.each(contextChanges)('releases the lock on %s and ignores the old save rejecting later', (_label, change) => {
    const { store, lock, attempt, retry } = startInDraftA();
    act(() => { change(store); });
    expect(lock.isLocked()).toBe(false);
    lock.settle(attempt, 'Player One was not recorded. Network down.');
    expect(lock.store.getState().failure).toBeNull();
    // Its retry (kept by a closed dialog) no longer records the old replacement into the new draft.
    attempt.retry();
    expect(retry).not.toHaveBeenCalled();
  });

  it.each(contextChanges)('does not publish the old save timing out after %s', (_label, change) => {
    const { store, lock } = startInDraftA();
    act(() => { change(store); });
    act(() => { vi.advanceTimersByTime(PICK_SAVE_TIMEOUT_MS * 2); });
    expect(lock.store.getState().failure).toBeNull();
    expect(lock.isLocked()).toBe(false);
  });

  it('keeps the lock while the same draft records a pick, and its retry still works', () => {
    const { store, lock, attempt, retry } = startInDraftA();
    act(() => { store.setState({ draftHistory: [...store.getState().draftHistory] }); });
    expect(lock.isLocked()).toBe(true);
    lock.settle(attempt, 'Player One was not recorded. Network down.');
    expect(lock.store.getState().failure?.message).toContain('Network down');
    attempt.retry();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

it('keeps a pending save when a storage publication rebuilds the same draft\'s objects', () => {
  const store = createDraftStore();
  act(() => { store.setState({ liveSession: { provider: 'sleeper', draftId: 'draft-a' } }); });
  const lock = getPickLock(workspaceForTestStore(store));
  const retry = vi.fn();
  const attempt = { ...pick, retry: lock.bindRetry(retry) };
  expect(lock.begin(attempt)).toBe(true);
  // A queue write publishes the same session and progress as new, equal objects.
  act(() => { store.setState({ liveSession: { provider: 'sleeper', draftId: 'draft-a' }, draftProgress: { ...store.getState().draftProgress }, shortlistedPlayerIds: ['p2'] }); });
  expect(lock.isLocked()).toBe(true);
  lock.settle(attempt, 'Player One was not recorded. Network down.');
  expect(lock.store.getState().failure?.message).toContain('Network down');
  attempt.retry();
  expect(retry).toHaveBeenCalledTimes(1);
});


describe('restarting an empty draft', () => {
  it('releases a slow first pick, so the restarted draft is not locked by the old save', () => {
    const store = createDraftStore();
    const workspace = workspaceForTestStore(store);
    const lock = getPickLock(workspace);
    expect(store.getState().draftHistory).toHaveLength(0);
    const first = { ...pick };
    expect(lock.begin(first)).toBe(true);
    const contextBefore = lock.context();
    const stale = lock.bindRetry(vi.fn());
    act(() => { sendWorkspaceCommand(workspace, 'resetDraft'); });
    expect(lock.isLocked()).toBe(false);
    expect(lock.context()).toBe(contextBefore + 1);
    // The old save's late answer neither settles nor fails the new draft.
    lock.settle(first, 'Player One was not drafted.');
    expect(lock.store.getState().failure).toBeNull();
    expect(lock.begin({ ...pick, playerId: 'p2' })).toBe(true);
    stale();
  });
});
