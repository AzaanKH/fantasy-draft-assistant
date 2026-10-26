// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setTimeout as delay } from 'node:timers';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PersistedDraftSession } from '@/stores/draftSessionStorage';
import { showStorageActivation } from './activation-entry';
import * as activationStorage from './activation-storage';
import { initialDraftState, sessionFromState } from './draft-reducer';
import { decodeIndexedSession } from './idb-session';
import { openDraftDatabase, type DraftDatabase } from './indexed-db';
import { verifyStorageSharing } from './storage-sharing';
import type { Workspace } from './workspace';

const notice = 'Still opening your draft storage. This usually means another draft tab is busy. Close other draft tabs or reload.';
const identity = { provider: 'sleeper', draftId: 'slow-startup' } as const;
const views: Array<{ root: Root; container: HTMLElement; workspace?: Workspace }> = [];
const databases: DraftDatabase[] = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  history.replaceState(null, '', '/draft?provider=sleeper&draftId=slow-startup&position=1');
});
afterEach(() => {
  for (const view of views.splice(0)) {
    act(() => { view.root.unmount(); }); view.workspace?.dispose(); view.container.remove();
  }
  for (const database of databases.splice(0)) database.close();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  history.replaceState(null, '', '/');
});
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await act(async () => {
    await new Promise<void>(resolve => { delay(resolve, 5); });
  });
  expect(predicate()).toBe(true);
}
async function start(firstActivation: boolean) {
  const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: vi.fn() });
  databases.push(database);
  const session = sessionFromState(initialDraftState(identity), identity, 0);
  await database.update(identity, () => ({ session, result: undefined }));
  let resolve = (_value: PersistedDraftSession | null) => {};
  let reject = (_reason: Error) => {};
  const pending = new Promise<PersistedDraftSession | null>((accept, fail) => { resolve = accept; reject = fail; });
  const read = vi.spyOn(database, 'read').mockImplementationOnce(() => pending);
  const close = vi.spyOn(database, 'close');
  const controller = {
    resume: async () => firstActivation ? null : database,
    preflight: async (): Promise<activationStorage.ActivationReview> => ({
      status: 'review', phase: 'fresh', ready: true, sessions: [], source: [], blockers: [],
      sourceDigest: '', unchanged: [], rejected: [], unresolved: [], pending: [], stale: [], tombstone: 'absent', digest: '',
      indexed: { sessions: [], invalid: [], refusals: [], activation: null },
    }),
    activate: async () => database, cancel: vi.fn(), close: vi.fn(),
  };
  vi.spyOn(activationStorage, 'createActivationStorage').mockReturnValue(controller);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const view: typeof views[number] = { root, container }; views.push(view);
  const ready = vi.fn((workspace: Workspace) => {
    view.workspace = workspace; root.render(<div data-app-mounted />);
  });
  const verified = await verifyStorageSharing({ canonicalOrigin: location.origin, location });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  act(() => { showStorageActivation({ root, verified, ready }); });
  if (firstActivation) {
    await until(() => Boolean(container.querySelector('input')));
    act(() => { container.querySelector('input')?.click(); });
    act(() => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Activate IndexedDB')?.click(); });
  }
  await until(() => read.mock.calls.length > 0);
  return { view, ready, close, controller, resolve: () => { resolve(session); }, reject };
}

for (const firstActivation of [false, true]) {
  const path = firstActivation ? 'first activation' : 'resume';
  it(`${path} keeps waiting after 10 seconds and mounts App when the initial read eventually resolves`, async () => {
    const run = await start(firstActivation);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_900); });
    expect(run.view.container.textContent).not.toContain(notice);
    expect(run.ready).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(run.view.container.textContent).toContain(notice);
    expect(run.view.container.querySelector('[data-app-mounted]')).toBeNull();
    expect(run.close).not.toHaveBeenCalled();
    expect(run.controller.close).not.toHaveBeenCalled();
    await act(async () => { run.resolve(); });
    await until(() => run.ready.mock.calls.length === 1);
    expect(run.view.container.querySelector('[data-app-mounted]')).not.toBeNull();
    expect(run.view.container.textContent).not.toContain(notice);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it(`${path} replaces the slow notice with the existing failure copy on rejection`, async () => {
    const run = await start(firstActivation);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(run.view.container.textContent).toContain(notice);
    await act(async () => { run.reject(new Error('Storage read failed')); });
    await until(() => Boolean(run.view.container.querySelector('[role="alert"]')));
    expect(run.view.container.textContent).toContain(firstActivation ? 'Draft storage was activated' : 'Draft storage setup failed');
    expect(run.view.container.textContent).toContain('Reload the page');
    expect(run.view.container.textContent).not.toContain(notice);
    expect(run.ready).not.toHaveBeenCalled();
    expect(run.controller.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
}

it('reloads the page when the slow-storage Reload button is clicked', async () => {
  const reload = vi.fn();
  const run = await start(false);
  vi.stubGlobal('location', { reload });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  const button = [...run.view.container.querySelectorAll('button')].find(button => button.textContent === 'Reload');
  expect(button).toBeDefined();
  act(() => { button?.click(); });
  expect(reload).toHaveBeenCalledOnce();
});

it('clears the slow-storage timer when readiness resolves before 10 seconds', async () => {
  const run = await start(false);
  await act(async () => { run.resolve(); });
  await until(() => run.ready.mock.calls.length === 1);
  // jsdom queues a zero-delay storage event when the connection hint is saved.
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(run.view.container.textContent).not.toContain(notice);
});

it('clears the timer on unmount without publishing an eventually ready workspace', async () => {
  const run = await start(false);
  act(() => { run.view.root.unmount(); }); views.splice(views.indexOf(run.view), 1); run.view.container.remove();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { run.resolve(); });
  await until(() => run.close.mock.calls.length > 0);
  expect(run.ready).not.toHaveBeenCalled();
});

it('clears the timer when the initial read rejects before the notice appears', async () => {
  const run = await start(false);
  await act(async () => { run.reject(new Error('Early storage failure')); });
  await until(() => Boolean(run.view.container.querySelector('[role="alert"]')));
  expect(run.view.container.textContent).toContain('Early storage failure');
  expect(vi.getTimerCount()).toBe(0);
});
