import { decodeStoredDraftSessionRecord, decodeStoredDraftProgress } from '@fantasy-draft/shared/catalog';
import { DEFAULT_DECISION_LENS, deriveDraftCursor, resolveSavedDecisionLens } from '@fantasy-draft/shared/draft';
import type { PersistedDraftSession } from '@/stores/draftSessionStorage';

export function decodeIndexedSession(input: unknown): PersistedDraftSession {
  const value = decodeStoredDraftSessionRecord(input);
  const draftProgress = decodeStoredDraftProgress(value.draftProgress);
  if (draftProgress.historyPrefix?.some(slot => !value.draftHistory.some(pick => pick.pickNumber === slot)) ||
      draftProgress.historyLength > value.draftHistory.length ||
      deriveDraftCursor(value.draftHistory, draftProgress) !== value.currentPick ||
      new Set(value.draftHistory.map(pick => pick.pickNumber)).size !== value.draftHistory.length ||
      new Set(value.draftHistory.map(pick => pick.playerId)).size !== value.draftHistory.length) throw new Error('Invalid IndexedDB session facts');
  // A session saved before Ranked Fit moves an unchosen Best Pick to the new default.
  return { ...value, decisionLens: resolveSavedDecisionLens(value), decisionLensDefault: DEFAULT_DECISION_LENS,
    lineage: [...value.lineage], draftProgress,
    draftHistory: [...value.draftHistory], shortlistedPlayerIds: [...value.shortlistedPlayerIds],
    preloadedKeepers: [...value.preloadedKeepers], unresolvedProviderPicks: [...value.unresolvedProviderPicks] };
}
