import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readOptionalJson } from './generate-draft-prep-report.js';

describe('readOptionalJson', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'draft-prep-report-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns parsed JSON when the file is valid', async () => {
    const path = join(dir, 'current-keepers.json');
    await writeFile(path, JSON.stringify({ season: 2026, keepers: [] }));

    await expect(readOptionalJson(path)).resolves.toEqual({ season: 2026, keepers: [] });
  });

  it('returns null when the file is missing', async () => {
    await expect(readOptionalJson(join(dir, 'missing.json'))).resolves.toBeNull();
  });

  it('returns null instead of rejecting when the file is corrupt', async () => {
    const path = join(dir, 'current-keepers.json');
    await writeFile(path, '{ "season": 2026, "keepers": [');

    await expect(readOptionalJson(path)).resolves.toBeNull();
  });
});
