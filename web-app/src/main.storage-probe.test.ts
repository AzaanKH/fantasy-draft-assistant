// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ probe: vi.fn(), createBrowserWorkspace: vi.fn(), createHarnessWorkspace: vi.fn(), render: vi.fn() }));
vi.mock('./workspace/storage-sharing', () => ({ serveStorageProbe: calls.probe }));
vi.mock('./workspace/browser-workspace', () => ({ createBrowserWorkspace: calls.createBrowserWorkspace }));
vi.mock('./workspace/harness-workspace', () => ({ createHarnessWorkspace: calls.createHarnessWorkspace }));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: calls.render }) }));

afterEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); vi.resetModules();
  history.replaceState(null, '', '/'); document.body.innerHTML = '';
});

it.each([false, true])('keeps the helper route free of workspace construction when failure is %s', async fails => {
  vi.stubEnv('VITE_PERSISTENCE_HARNESS', 'idb');
  vi.stubEnv('VITE_CANONICAL_WEB_ORIGIN', location.origin);
  document.body.innerHTML = '<div id="root"></div>';
  history.replaceState(null, '', '/?__storageProbe=test-nonce');
  if (fails) calls.probe.mockRejectedValueOnce(new Error('Probe denied'));
  else calls.probe.mockResolvedValueOnce(undefined);
  await import('./main');
  await vi.waitFor(() => { expect(calls.probe).toHaveBeenCalledWith('test-nonce', { canonicalOrigin: location.origin }); });
  if (fails) await vi.waitFor(() => { expect(calls.render).toHaveBeenCalledOnce(); });
  expect(calls.createBrowserWorkspace).not.toHaveBeenCalled();
  expect(calls.createHarnessWorkspace).not.toHaveBeenCalled();
});
