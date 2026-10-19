import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./effect-runtime.js', async importOriginal => ({
  ...await importOriginal<typeof import('./effect-runtime.js')>(),
  runMain: vi.fn(),
}));
import { readExistingSnapshot } from './refresh-fantasypros-snapshot.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('FantasyPros existing snapshot cache', () => {
  it('does not warn on the first refresh without a saved snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fantasypros-cache-'));
    directories.push(directory);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readExistingSnapshot(join(directory, 'missing.json'))).resolves.toBeUndefined();
    expect(warning).not.toHaveBeenCalled();
  });
  it('warns when a saved snapshot cannot be decoded', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fantasypros-cache-'));
    directories.push(directory);
    const path = join(directory, 'invalid.json');
    await writeFile(path, JSON.stringify({ metadata: { season: 2026 }, rankings: [] }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readExistingSnapshot(path)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('cannot be reused'));
  });
  it('warns on saved snapshot read errors other than absence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fantasypros-cache-'));
    directories.push(directory);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readExistingSnapshot(directory)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('cannot be reused'));
  });
});
