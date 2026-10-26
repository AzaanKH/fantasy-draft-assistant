import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([
  [undefined, true],
  ['idb', true],
  ['v1', false],
  ['unknown', false],
])('selects durable storage for build setting %s: %s', async (setting, enabled) => {
  vi.stubEnv('VITE_STORAGE_ACTIVATION', setting);
  vi.resetModules();
  const { STORAGE_ACTIVATION_ENABLED } = await import('./storage-activation.js');
  expect(STORAGE_ACTIVATION_ENABLED).toBe(enabled);
});
