import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

it('labels existing malformed files invalid and preserves missing-file labels', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(readFile).mockImplementation(async path => {
    if (typeof path !== 'string') throw new Error('Expected a file path');
    if (path.endsWith('fantasypros-snapshot.json')) return '{}';
    throw Object.assign(new Error('not found'), { code: 'ENOENT' });
  });
  await import('./check-data-freshness.js');
  await vi.waitFor(() => { expect(log).toHaveBeenCalledWith(expect.stringMatching(/^INVALID.*Trusted rankings/)); });
  expect(log).toHaveBeenCalledWith(expect.stringMatching(/^MISS/));
});
