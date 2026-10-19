import { CATALOG, catalogPath, decodeLeagueSurvivalModel } from '@fantasy-draft/shared/catalog';
import type { LeagueSurvivalModel } from '@fantasy-draft/shared/draft';

export async function fetchLeagueSurvivalModel(): Promise<(LeagueSurvivalModel & { readonly warnings: readonly string[] }) | null> {
  const response = await fetch(`/${catalogPath(CATALOG.survival)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load league survival model: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  const warnings: string[] = [];
  try {
    const model = decodeLeagueSurvivalModel(parsed, { onWarning: message => warnings.push(message) });
    return { ...model, warnings };
  } catch (error) {
    throw new Error(`Invalid league survival model shape from /${catalogPath(CATALOG.survival)}: ${String(error)}`);
  }
}
