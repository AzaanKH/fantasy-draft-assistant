// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ probe: vi.fn(), verify: vi.fn(), appImported: vi.fn(),
  createBrowserWorkspace: vi.fn((_search: string, factory?: () => unknown) => factory?.()),
  createHarnessWorkspace: vi.fn(), render: vi.fn() }));
vi.mock('./workspace/storage-sharing', () => ({ serveStorageProbe: calls.probe, verifyStorageSharing: calls.verify }));
vi.mock('./workspace/browser-workspace', () => ({ createBrowserWorkspace: calls.createBrowserWorkspace }));
vi.mock('./workspace/harness-workspace', () => ({ createHarnessWorkspace: calls.createHarnessWorkspace }));
vi.mock('./App', () => { calls.appImported(); return { App: () => null }; });
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: calls.render }) }));

afterEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
  history.replaceState(null, '', '/'); document.body.innerHTML = '';
});

it.each([false, true])('keeps the helper route free of workspace construction when failure is %s', async fails => {
  vi.stubEnv('VITE_PERSISTENCE_HARNESS', 'idb');
  vi.stubEnv('VITE_CANONICAL_WEB_ORIGIN', location.origin);
  calls.verify.mockResolvedValueOnce({ origin: location.origin, kind: 'origin-only' });
  document.body.innerHTML = '<div id="root"></div>';
  history.replaceState(null, '', '/?__storageProbe=test-nonce');
  if (fails) calls.probe.mockRejectedValueOnce(new Error('Probe denied'));
  else calls.probe.mockResolvedValueOnce(undefined);
  await import('./main');
  await vi.dynamicImportSettled();
  expect(calls.probe).toHaveBeenCalledWith('test-nonce', { canonicalOrigin: location.origin });
  expect(calls.render).toHaveBeenCalledTimes(fails ? 1 : 0);
  expect(calls.verify).not.toHaveBeenCalled();
  expect(calls.appImported).not.toHaveBeenCalled();
  expect(calls.createBrowserWorkspace).not.toHaveBeenCalled();
  expect(calls.createHarnessWorkspace).not.toHaveBeenCalled();
});

it('constructs the normal harness through the verified factory as a control', async () => {
  vi.stubEnv('VITE_PERSISTENCE_HARNESS', 'idb');
  vi.stubEnv('VITE_CANONICAL_WEB_ORIGIN', location.origin);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const verified = { origin: location.origin, kind: 'origin-only' };
  calls.verify.mockResolvedValueOnce(verified);
  document.body.innerHTML = '<div id="root"></div>';
  await import('./main');
  await vi.dynamicImportSettled();
  expect(calls.verify).toHaveBeenCalledOnce();
  expect(calls.createBrowserWorkspace).toHaveBeenCalledOnce();
  expect(calls.createHarnessWorkspace).toHaveBeenCalledWith(verified);
  expect(calls.render).toHaveBeenCalledOnce();
});
