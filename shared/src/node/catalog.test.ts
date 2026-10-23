import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readCatalogArtifact } from './catalog.js';

it('preserves parsed readiness values and distinguishes invalid JSON from absent files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-reader-'));
  try {
    await writeFile(join(root, 'valid.json'), '{"ready":true}');
    await writeFile(join(root, 'invalid.json'), '{');
    expect(await readCatalogArtifact(root, 'valid.json')).toEqual({ path: 'valid.json', value: { ready: true }, error: null });
    expect(await readCatalogArtifact(root, 'invalid.json')).toMatchObject({ path: 'invalid.json', value: null, error: expect.any(String) });
    expect((await readCatalogArtifact(root, 'missing.json')).error).toContain('ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
