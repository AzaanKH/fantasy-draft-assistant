// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import type { Workspace } from './workspace';
import { showStorageActivation } from './activation-entry';
import { verifyStorageSharing } from './storage-sharing';
import * as activationStorage from './activation-storage';
import { initialDraftState, sessionFromState } from './draft-reducer';

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 5); }); });
  expect(predicate()).toBe(true);
}
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals(); });
it('reviews changed v1 data again and allows a deliberate retry without a reload', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  const verified = await verifyStorageSharing({ canonicalOrigin: 'http://localhost:3000', location: { origin: 'http://localhost:3000', pathname: '/draft', search: '' } });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  let mounted: Workspace | undefined;
  const ready = vi.fn((workspace: Workspace) => { mounted = workspace; });
  try {
    act(() => { showStorageActivation({ root, verified: { ...verified, origin: location.origin }, ready }); });
    await until(() => Boolean(container.querySelector('input[type="checkbox"]')));
    const identity = { provider: 'sleeper', draftId: '123' } as const;
    localStorage.setItem('fantasy-draft-session-v1:sleeper:123', JSON.stringify(sessionFromState(initialDraftState(identity), identity, 0)));
    const check = (): HTMLInputElement => { const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]'); if (!input) throw new Error('Missing confirmation'); return input; };
    const activate = (): HTMLButtonElement => { const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Activate IndexedDB'); if (!button) throw new Error('Missing activation'); return button; };
    act(() => { check().click(); });
    act(() => { activate().click(); });
    await until(() => Boolean(container.querySelector('[role="alert"]')));
    expect(ready).not.toHaveBeenCalled();
    expect(container.textContent).toContain('sleeper 123');
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).toBeNull();
    act(() => { check().click(); });
    act(() => { activate().click(); });
    await until(() => ready.mock.calls.length === 1);
    expect(ready).toHaveBeenCalledOnce();
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
  } finally {
    mounted?.dispose();
    act(() => { root.unmount(); }); container.remove();
  }
});


it('surfaces a failed stale preflight in the setup UI and releases pending state', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  const activate = vi.fn().mockRejectedValue(new activationStorage.ActivationStaleError({ status: 'rollback-in-progress', message: 'changed' }));
  const preflight = vi.fn().mockResolvedValueOnce({ status: 'review', ready: true, sessions: [], source: [], blockers: [] }).mockRejectedValueOnce(new Error('Preflight storage denied'));
  vi.spyOn(activationStorage, 'createActivationStorage').mockReturnValue({ resume: async () => null, preflight, activate, cancel: vi.fn(), close: vi.fn() });
  const verified = await verifyStorageSharing({ canonicalOrigin: 'http://localhost:3000', location: { origin: 'http://localhost:3000', pathname: '/draft', search: '' } });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    act(() => { showStorageActivation({ root, verified: { ...verified, origin: location.origin }, ready: vi.fn() }); });
    await until(() => Boolean(container.querySelector('input')));
    act(() => { container.querySelector('input')?.click(); });
    act(() => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Activate IndexedDB')?.click(); });
    await until(() => container.textContent.includes('Preflight storage denied'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Preflight storage denied');
    expect(container.textContent).not.toContain('Activating...');
  } finally { act(() => { root.unmount(); }); }
});

it('keeps seeded v1 drafts read only until confirmation, then imports before marking activation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  history.replaceState(null, '', '/draft?provider=sleeper&draftId=first-run&position=1');
  const identity = { provider: 'sleeper', draftId: 'first-run' } as const;
  const source = sessionFromState({ ...initialDraftState(identity), shortlistedPlayerIds: ['kept-player'] }, identity, 0);
  const key = 'fantasy-draft-session-v1:sleeper:first-run';
  const serialized = JSON.stringify(source);
  localStorage.setItem(key, serialized);
  const verified = await verifyStorageSharing({ canonicalOrigin: location.origin, location });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let mounted: Workspace | undefined;
  const ready = vi.fn((workspace: Workspace) => { mounted = workspace; });
  try {
    act(() => { showStorageActivation({ root, verified, ready }); });
    await until(() => Boolean(container.querySelector('input')));
    expect(container.textContent).toContain('sleeper first-run: 0 picks, 1 queued');
    const button = [...container.querySelectorAll('button')].find(row => row.textContent === 'Activate IndexedDB');
    expect(button?.disabled).toBe(true);
    act(() => { button?.click(); });
    expect(ready).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(serialized);
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).toBeNull();
    act(() => { container.querySelector('input')?.click(); });
    act(() => { button?.click(); });
    await until(() => ready.mock.calls.length === 1);
    await until(() => mounted?.draft.getState().shortlistedPlayerIds.includes('kept-player') ?? false);
    expect(mounted?.draft.getState().shortlistedPlayerIds).toEqual(['kept-player']);
    expect(localStorage.getItem(key)).toBe(serialized);
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
  } finally { mounted?.dispose(); act(() => { root.unmount(); }); container.remove(); history.replaceState(null, '', '/'); }
});

it('requires reload after activation commits but the first workspace binding fails', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  history.replaceState(null, '', '/draft?provider=sleeper&draftId=first-bind&position=1');
  const identity = { provider: 'sleeper', draftId: 'first-bind' } as const;
  localStorage.setItem('fantasy-draft-session-v1:sleeper:first-bind', JSON.stringify(sessionFromState(initialDraftState(identity), identity, 0)));
  const controller = activationStorage.createActivationStorage({ storage: localStorage, factory: indexedDB, report: vi.fn() });
  const activate = controller.activate.bind(controller);
  const attempts = vi.spyOn(controller, 'activate').mockImplementation(async (...args) => {
    const database = await activate(...args);
    vi.spyOn(database, 'read').mockRejectedValue(new Error('Initial draft read failed'));
    return database;
  });
  const close = vi.spyOn(controller, 'close');
  vi.spyOn(activationStorage, 'createActivationStorage').mockReturnValue(controller);
  const verified = await verifyStorageSharing({ canonicalOrigin: location.origin, location });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const ready = vi.fn();
  try {
    act(() => { showStorageActivation({ root, verified, ready }); });
    await until(() => Boolean(container.querySelector('input')));
    act(() => { container.querySelector('input')?.click(); });
    act(() => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Activate IndexedDB')?.click(); });
    await until(() => container.textContent.includes('Initial draft read failed'));
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
    expect(ready).not.toHaveBeenCalled();
    const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'Activate IndexedDB');
    expect(retry?.disabled ?? true).toBe(true);
    expect(container.textContent).toContain('Draft storage was activated');
    expect(container.textContent).toContain('Reload the page');
    expect(container.textContent).not.toContain('private browsing');
    expect(container.textContent).not.toContain('Your drafts stay in the current storage');
    expect(close).toHaveBeenCalled();
    act(() => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Activate IndexedDB' && !button.disabled)?.click(); });
    expect(attempts).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Reload the page');
  } finally { controller.close(); act(() => { root.unmount(); }); container.remove(); history.replaceState(null, '', '/'); }
});
