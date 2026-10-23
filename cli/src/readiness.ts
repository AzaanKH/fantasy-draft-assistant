import { readCatalogArtifact } from '@fantasy-draft/shared/node';
import { buildDraftReadinessReport as buildReport } from '@fantasy-draft/shared/catalog';
import type { DraftReadinessReport } from '@fantasy-draft/shared/catalog';

export function buildDraftReadinessReport(now: number, repoRoot: string): Promise<DraftReadinessReport> {
  return buildReport(now, path => readCatalogArtifact(repoRoot, path));
}
