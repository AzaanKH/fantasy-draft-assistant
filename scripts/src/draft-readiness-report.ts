import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildDraftReadinessReport as buildReport, type LoadedArtifact } from '@fantasy-draft/shared/catalog';
import type { DraftReadinessReport } from '@fantasy-draft/shared';

export function buildDraftReadinessReport(now: number, repoRoot: string = resolve(fileURLToPath(new URL('../..', import.meta.url)))): Promise<DraftReadinessReport> {
  return buildReport(now, async (path): Promise<LoadedArtifact> => {
    try {
      const value: unknown = JSON.parse(await readFile(join(repoRoot, path), 'utf8'));
      return { path, value, error: null };
    } catch (error) {
      return { path, value: null, error: error instanceof Error ? error.message : 'unknown read error' };
    }
  });
}

export { areKeepersValid } from '@fantasy-draft/shared/catalog';
