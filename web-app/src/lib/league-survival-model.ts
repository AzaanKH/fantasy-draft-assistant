import { isLeagueSurvivalModel } from '@fantasy-draft/shared/catalog';
import type { LeagueSurvivalModel } from '@fantasy-draft/shared/draft';

export async function fetchLeagueSurvivalModel(): Promise<LeagueSurvivalModel | null> {
  const response = await fetch('/data/league-history/survival-model.json');
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load league survival model: ${String(response.status)}`);
  }
  const parsed = await response.json() as unknown;
  if (!isLeagueSurvivalModel(parsed)) {
    throw new Error('Invalid league survival model shape from /data/league-history/survival-model.json');
  }
  return parsed;
}
