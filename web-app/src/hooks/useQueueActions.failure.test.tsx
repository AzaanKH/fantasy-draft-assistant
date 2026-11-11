// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceProvider } from '@/workspace/WorkspaceProvider';
import { workspaceForTestStore } from '@/workspace/workspace-test-helpers';
import { useQueueActions } from './useQueueActions';

const toasts = vi.hoisted(() => ({ error: vi.fn(), plain: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(toasts.plain, { error: toasts.error, dismiss: toasts.dismiss }) }));
vi.mock('@fantasy-draft/shared/sync', async (original) => ({ ...await original<object>(), STORAGE_ACTIVATION_ENABLED: true }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); toasts.error.mockReset(); toasts.plain.mockReset(); toasts.dismiss.mockReset(); });

it('reports a failed queue save with Retry instead of failing silently', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const store = createDraftStore({ storage: null });
  const sendDurable = vi.fn<(command: unknown) => Promise<unknown>>(() => Promise.reject(new Error('Storage is full.')));
  const dismissError = vi.fn();
  const workspace = { ...workspaceForTestStore(store), sendDurable, dismissError };
  let actions: ReturnType<typeof useQueueActions> | undefined;
  function Consumer() { actions = useQueueActions([{ id: 'p1', name: 'Player One' }]); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });

  await act(async () => { actions?.togglePlayerQueued('p1'); await Promise.resolve(); await Promise.resolve(); });
  expect(toasts.plain).not.toHaveBeenCalled();
  expect(toasts.error).toHaveBeenCalledWith('Player One was not added to your queue. Storage is full.', expect.objectContaining({ id: 'queue:p1', duration: Number.POSITIVE_INFINITY }));
  expect(dismissError).toHaveBeenCalled();

  // Retry sends the same save again.
  sendDurable.mockImplementation(() => Promise.resolve({ result: undefined }));
  const options = toasts.error.mock.calls[0]?.[1] as { action: { onClick: () => void } };
  await act(async () => { options.action.onClick(); await Promise.resolve(); });
  expect(sendDurable).toHaveBeenLastCalledWith(['setPlayerShortlisted', 'p1', true]);
  act(() => { root.unmount(); });
});

type ToastOptions = { readonly id: string; readonly duration: number; readonly action: { onClick: () => void }; readonly cancel: { label: string; onClick: () => void } };

function mount(sendDurable: (command: unknown) => Promise<unknown>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const store = createDraftStore({ storage: null });
  const workspace = { ...workspaceForTestStore(store), sendDurable, dismissError: vi.fn() };
  let actions: ReturnType<typeof useQueueActions> | undefined;
  function Consumer() { actions = useQueueActions([{ id: 'p1', name: 'Player One' }]); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });
  return { store, actions: () => actions, unmount: () => { act(() => { root.unmount(); }); } };
}

it('turns a queue save that hangs for 15 seconds into a notice with Retry and Dismiss that stays', async () => {
  vi.useFakeTimers();
  const sendDurable = vi.fn<(command: unknown) => Promise<unknown>>(() => new Promise(() => {}));
  const page = mount(sendDurable);
  act(() => { page.actions()?.togglePlayerQueued('p1'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(14_900); });
  expect(toasts.error).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(toasts.error).toHaveBeenCalledWith('Player One may not have been added to your queue. The save did not finish within 15 seconds.', expect.objectContaining({ id: 'queue:p1', duration: Number.POSITIVE_INFINITY }));
  const options = toasts.error.mock.calls[0]?.[1] as ToastOptions;
  expect(options.cancel.label).toBe('Dismiss');
  options.cancel.onClick();
  expect(toasts.dismiss).toHaveBeenCalledWith('queue:p1');
  // Retry sends the same save again.
  options.action.onClick();
  expect(sendDurable).toHaveBeenCalledTimes(2);
  expect(sendDurable).toHaveBeenLastCalledWith(['setPlayerShortlisted', 'p1', true]);
  page.unmount();
});

it('binds Retry to the draft it failed in, ignores a late answer from the old draft and dismisses its notices', async () => {
  let rejectFirst: ((error: Error) => void) | undefined;
  const sendDurable = vi.fn<(command: unknown) => Promise<unknown>>()
    .mockImplementationOnce(() => Promise.reject(new Error('Storage is full.')))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockImplementation(() => Promise.resolve({ result: undefined }));
  const page = mount(sendDurable);
  await act(async () => { page.actions()?.togglePlayerQueued('p1'); await Promise.resolve(); await Promise.resolve(); });
  const options = toasts.error.mock.calls[0]?.[1] as ToastOptions;
  // A second save is still pending when the manager switches to another draft.
  act(() => { page.actions()?.togglePlayerQueued('p1'); });
  act(() => { page.store.setState({ sessionMode: page.store.getState().sessionMode === 'mock' ? 'live' : 'mock' }); });
  expect(toasts.dismiss).toHaveBeenCalledWith('queue:p1');
  // Retry from draft A does nothing in draft B, and A's late failure shows nothing in B.
  options.action.onClick();
  expect(sendDurable).toHaveBeenCalledTimes(2);
  await act(async () => { rejectFirst?.(new Error('late')); await Promise.resolve(); await Promise.resolve(); });
  expect(toasts.error).toHaveBeenCalledTimes(1);
  page.unmount();
});

it('clears the generic save notice for a late failure after the timeout, without a second queue notice', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let reject: ((error: Error) => void) | undefined;
  const store = createDraftStore({ storage: null });
  const sendDurable = vi.fn<(command: unknown) => Promise<unknown>>(() => new Promise((_resolve, fail) => { reject = fail; }));
  const dismissError = vi.fn();
  const workspace = { ...workspaceForTestStore(store), sendDurable, dismissError };
  let actions: ReturnType<typeof useQueueActions> | undefined;
  function Consumer() { actions = useQueueActions([{ id: 'p1', name: 'Player One' }]); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });
  act(() => { actions?.togglePlayerQueued('p1'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_100); });
  expect(toasts.error).toHaveBeenCalledTimes(1);
  dismissError.mockClear();
  // The durable writer publishes its generic notice, then the late rejection reaches the queue handler.
  await act(async () => { reject?.(new Error('Storage is full.')); await Promise.resolve(); await Promise.resolve(); });
  expect(dismissError).toHaveBeenCalled();
  expect(toasts.error).toHaveBeenCalledTimes(1);
  act(() => { root.unmount(); });
});
