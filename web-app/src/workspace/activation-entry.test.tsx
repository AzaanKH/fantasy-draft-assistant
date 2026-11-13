// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import type { Workspace } from './workspace';
import { settleActivation, showStorageActivation } from './activation-entry';
import { verifyStorageSharing } from './storage-sharing';
import * as activationStorage from './activation-storage';
import { initialDraftState, sessionFromState } from './draft-reducer';

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 5); }); });
  expect(predicate()).toBe(true);
}
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals(); });
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  const verified = await verifyStorageSharing({ canonicalOrigin: location.origin, location });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const view: { mounted?: Workspace } = {};
  const ready = vi.fn((workspace: Workspace) => { view.mounted = workspace; });
  return { container, ready, view,
    show: () => { act(() => { showStorageActivation({ root, verified, ready }); }); },
    unmount: () => { view.mounted?.dispose(); act(() => { root.unmount(); }); container.remove(); history.replaceState(null, '', '/'); } };
}

function saveV1(draftId: string, state: Partial<ReturnType<typeof initialDraftState>> = {}): { key: string; serialized: string } {
  const identity = { provider: 'sleeper', draftId } as const;
  const key = `fantasy-draft-session-v1:sleeper:${draftId}`;
  const serialized = JSON.stringify(sessionFromState({ ...initialDraftState(identity), ...state }, identity, 0));
  localStorage.setItem(key, serialized);
  return { key, serialized };
}

it('activates an empty browser and opens the app', async () => {
  const page = await mount();
  try {
    page.show();
    await until(() => page.ready.mock.calls.length === 1);
    expect(page.container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
  } finally { page.unmount(); }
});

it('moves a draft saved in the older format across without a review screen and leaves its bytes in place', async () => {
  history.replaceState(null, '', '/draft?provider=sleeper&draftId=first-run&position=1');
  const { key, serialized } = saveV1('first-run', { shortlistedPlayerIds: ['kept-player'] });
  const page = await mount();
  try {
    page.show();
    await until(() => page.ready.mock.calls.length === 1);
    await until(() => page.view.mounted?.draft.getState().shortlistedPlayerIds.includes('kept-player') ?? false);
    expect(page.container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(localStorage.getItem(key)).toBe(serialized);
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
  } finally { page.unmount(); }
});

it('reads the saved drafts again when one changes between the check and the write', async () => {
  saveV1('seeded');
  const page = await mount();
  const controller = activationStorage.createActivationStorage({ storage: localStorage, factory: indexedDB, report: vi.fn() });
  const activate = controller.activate.bind(controller);
  const attempts = vi.spyOn(controller, 'activate').mockImplementationOnce(async (...args) => { saveV1('late'); return activate(...args); });
  vi.spyOn(activationStorage, 'createActivationStorage').mockReturnValue(controller);
  try {
    page.show();
    await until(() => page.ready.mock.calls.length === 1);
    expect(attempts).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
  } finally { page.unmount(); }
});

it('shows why storage could not open and leaves the marker unwritten', async () => {
  const page = await mount();
  const close = vi.fn();
  vi.spyOn(activationStorage, 'createActivationStorage').mockReturnValue({ resume: async () => null, activate: vi.fn(), cancel: vi.fn(), close,
    preflight: vi.fn().mockResolvedValue({ status: 'unavailable', reason: 'blocked', message: 'IndexedDB is blocked in this browser.', error: null }) });
  try {
    page.show();
    await until(() => Boolean(page.container.querySelector('[role="alert"]')));
    expect(page.container.textContent).toContain('IndexedDB is blocked in this browser.');
    expect(page.ready).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).toBeNull();
  } finally { page.unmount(); }
});

it('settles every record that needs a decision, keeping the imported session where that is offered', async () => {
  const blocker = (id: string, actions: readonly string[]) => ({ id, digest: `digest-${id}`, actions });
  const preflight = vi.fn()
    .mockResolvedValueOnce({ status: 'review', ready: false, blockers: [blocker('journal', ['keep-imported', 'discard-entry']), blocker('corrupt', ['discard-entry'])] })
    .mockResolvedValueOnce({ status: 'review', ready: true, blockers: [blocker('journal', ['keep-imported', 'discard-entry']), blocker('corrupt', ['discard-entry'])] });
  const controller = { preflight } as unknown as ReturnType<typeof activationStorage.createActivationStorage>;
  const { review, decisions } = await settleActivation(controller);
  expect(review).toMatchObject({ ready: true });
  expect(decisions).toEqual([
    { blockerId: 'journal', digest: 'digest-journal', action: 'keep-imported' },
    { blockerId: 'corrupt', digest: 'digest-corrupt', action: 'discard-entry' },
  ]);
  expect(preflight).toHaveBeenLastCalledWith(decisions);
});

it('requires reload after activation commits but the first workspace binding fails', async () => {
  history.replaceState(null, '', '/draft?provider=sleeper&draftId=first-bind&position=1');
  saveV1('first-bind');
  const page = await mount();
  const controller = activationStorage.createActivationStorage({ storage: localStorage, factory: indexedDB, report: vi.fn() });
  const activate = controller.activate.bind(controller);
  const attempts = vi.spyOn(controller, 'activate').mockImplementation(async (...args) => {
    const database = await activate(...args);
    vi.spyOn(database, 'read').mockRejectedValue(new Error('Initial draft read failed'));
    return database;
  });
  const close = vi.spyOn(controller, 'close');
  vi.spyOn(activationStorage, 'createActivationStorage').mockReturnValue(controller);
  try {
    page.show();
    await until(() => page.container.textContent.includes('Initial draft read failed'));
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
    expect(page.ready).not.toHaveBeenCalled();
    expect(page.container.textContent).toContain('Draft storage was activated');
    expect(page.container.textContent).toContain('Reload the page');
    expect(close).toHaveBeenCalled();
    expect(attempts).toHaveBeenCalledOnce();
  } finally { controller.close(); page.unmount(); }
});
