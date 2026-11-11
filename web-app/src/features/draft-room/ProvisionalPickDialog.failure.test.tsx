// @vitest-environment jsdom
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { PickFailureNotice } from '@/workspace/PickFailureNotice';
import { getPickLock, PICK_SAVE_TIMEOUT_MS } from '@/workspace/pick-in-flight';
import { workspaceForTestStore, WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { ProvisionalPickDialog } from './ProvisionalPickDialog';

const save = vi.hoisted(() => ({ reject: (error: Error): unknown => error, calls: 0 }));
// The Record save stays pending until the test rejects it.
vi.mock('@/workspace/ui-dispatch', () => ({
  requestWorkspace: () => { save.calls += 1; return new Promise<boolean>((_, reject) => { save.reject = reject; }); },
}));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('./LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: { provider: 'sleeper' } }) }));

let root: Root;
let container: HTMLDivElement;
const store = createDraftStore({ storage: null });

const harness = vi.hoisted(() => ({ keepMounted: false }));

/**
 * Opens Record the way a card does. By default the dialog is dropped when it closes; `keepMounted` keeps it rendered
 * closed instead, like the app's dialog during its exit animation, with the form still mounted.
 */
function Harness(): ReactElement {
  const [open, setOpen] = useState(true);
  const dialog = createElement(ProvisionalPickDialog, { open, initialPlayerId: VISUAL_PLAYERS[0]?.id, onOpenChange: (next: boolean) => { setOpen(next); } });
  return createElement('div', null, open || harness.keepMounted ? dialog : null, createElement(PickFailureNotice));
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === name);
  if (!button) throw new Error(`Missing ${name}`);
  return button;
}

function mount(): void {
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(Harness) })); });
}

beforeEach(() => {
  harness.keepMounted = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  store.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'linear' });
  store.setState({ sessionMode: 'live' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(Harness) })); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  getPickLock(workspaceForTestStore(store)).dismissFailure();
  vi.unstubAllGlobals();
});

it('hands a failure to the workspace notice when the dialog closed mid-save', async () => {
  act(() => { buttonNamed('Record Provisional Pick').click(); });
  expect(buttonNamed('Saving...')).toBeTruthy();
  // The user cancels while the save is still pending.
  act(() => { buttonNamed('Cancel').click(); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  await act(async () => { save.reject(new Error('Storage is full.')); await Promise.resolve(); });
  const notice = document.querySelector('aside[aria-label="Pick not saved"]');
  expect(notice?.textContent).toContain(`${VISUAL_PLAYERS[0]?.name ?? ''} was not recorded. Storage is full.`);
  expect(getPickLock(workspaceForTestStore(store)).isLocked()).toBe(false);
});

it('shows a failure in the open dialog only, and closing after reading it raises no notice', async () => {
  act(() => { buttonNamed('Record Provisional Pick').click(); });
  await act(async () => { save.reject(new Error('Storage is full.')); await Promise.resolve(); });
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Storage is full.');
  expect(document.querySelector('aside[aria-label="Pick not saved"]')).toBeNull();

  act(() => { buttonNamed('Cancel').click(); });
  expect(document.querySelector('aside[aria-label="Pick not saved"]')).toBeNull();
});

it('times out a hung save after the dialog closed, and the notice retries the same pick', async () => {
  vi.useFakeTimers();
  try {
    save.calls = 0;
    act(() => { buttonNamed('Record Provisional Pick').click(); });
    act(() => { buttonNamed('Cancel').click(); });
    act(() => { vi.advanceTimersByTime(PICK_SAVE_TIMEOUT_MS); });
    const notice = document.querySelector('aside[aria-label="Pick not saved"]');
    expect(notice?.textContent).toContain('did not finish');
    act(() => { buttonNamed('Retry').click(); });
    expect(save.calls).toBe(2);
    expect(getPickLock(workspaceForTestStore(store)).isLocked()).toBe(true);
    // The retry fails too; with the dialog gone, the notice reports it.
    await act(async () => { save.reject(new Error('Storage is full.')); await Promise.resolve(); });
    expect(document.querySelector('aside[aria-label="Pick not saved"]')?.textContent).toContain('was not recorded. Storage is full.');
  } finally {
    vi.useRealTimers();
  }
});

it('reports a failure that arrives in the same tick as Cancel, while the closing form is still mounted', async () => {
  harness.keepMounted = true;
  // Remount so the harness keeps the closed dialog (and its form) rendered.
  act(() => { root.unmount(); });
  root = createRoot(container);
  mount();
  act(() => { buttonNamed('Record Provisional Pick').click(); });
  await act(async () => {
    buttonNamed('Cancel').click();
    save.reject(new Error('Storage is full.'));
    await Promise.resolve();
  });
  // Let the exit finish: the form unmounts after the failure already arrived.
  harness.keepMounted = false;
  mount();
  const notice = document.querySelector('aside[aria-label="Pick not saved"]');
  expect(notice?.textContent).toContain(`${VISUAL_PLAYERS[0]?.name ?? ''} was not recorded. Storage is full.`);
  expect(notice?.querySelector('button')).toBeTruthy();
  expect(getPickLock(workspaceForTestStore(store)).isLocked()).toBe(false);
});
