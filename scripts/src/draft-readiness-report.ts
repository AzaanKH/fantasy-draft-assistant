import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalogArtifact } from '@fantasy-draft/shared/node';
import { buildDraftReadinessReport as buildReport } from '@fantasy-draft/shared/catalog';
import type { DraftReadinessReport } from '@fantasy-draft/shared/catalog';

export function buildDraftReadinessReport(now: number, repoRoot: string = resolve(fileURLToPath(new URL('../..', import.meta.url)))): Promise<DraftReadinessReport> {
  return buildReport(now, path => readCatalogArtifact(repoRoot, path));
}

export { areKeepersValid } from '@fantasy-draft/shared/catalog';
