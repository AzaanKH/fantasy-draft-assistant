import { http, HttpError } from '@fantasy-draft/shared/http';
import { BROWSER_HTTP_POLICY } from '@/lib/http';
import { CATALOG, catalogPath, decodeLeagueSurvivalModel } from '@fantasy-draft/shared/catalog';
import type { LeagueSurvivalModel } from '@fantasy-draft/shared/draft';

export async function fetchLeagueSurvivalModel(): Promise<(LeagueSurvivalModel & { readonly warnings: readonly string[] }) | null> {
  try {
    return await http.json(`/${catalogPath(CATALOG.survival)}`, parsed => {
      const warnings: string[] = [];
      try {
        const model = decodeLeagueSurvivalModel(parsed, { onWarning: message => warnings.push(message) });
        return { ...model, warnings };
      } catch (error) {
        throw new Error(`Invalid league survival model shape from /${catalogPath(CATALOG.survival)}: ${String(error)}`);
      }
    }, BROWSER_HTTP_POLICY);
  } catch (error) {
    if (error instanceof HttpError && error.kind === 'status') {
      if (error.status === 404) return null;
      throw new Error(`Failed to load league survival model: ${String(error.status)}`);
    }
    throw error;
  }
}
