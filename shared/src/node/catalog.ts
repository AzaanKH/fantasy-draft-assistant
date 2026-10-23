import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LoadedArtifact } from '../catalog/draft-readiness-report.js';

/** Read errors remain evidence for the readiness decoder instead of becoming missing data. */
export async function readCatalogArtifact(repoRoot: string, path: string): Promise<LoadedArtifact> {
  try {
    const value: unknown = JSON.parse(await readFile(join(repoRoot, path), 'utf8'));
    return { path, value, error: null };
  } catch (error) {
    return { path, value: null, error: error instanceof Error ? error.message : 'unknown read error' };
  }
}
