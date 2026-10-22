import { decodeStoredDraftSessionRecord, decodeStoredDraftProgress } from '@fantasy-draft/shared/catalog';
import { deriveDraftCursor } from '@fantasy-draft/shared/draft';
import type { PersistedDraftSession } from '@/stores/draftSessionStorage';

export function decodeIndexedSession(input: unknown): PersistedDraftSession {
  const value = decodeStoredDraftSessionRecord(input);
  const draftProgress = decodeStoredDraftProgress(value.draftProgress);
  if (draftProgress.historyLength > value.draftHistory.length ||
      deriveDraftCursor(value.draftHistory, draftProgress) !== value.currentPick ||
      new Set(value.draftHistory.map(pick => pick.pickNumber)).size !== value.draftHistory.length ||
      new Set(value.draftHistory.map(pick => pick.playerId)).size !== value.draftHistory.length) throw new Error('Invalid IndexedDB session facts');
  // eslint-disable-next-line no-restricted-syntax -- v1 imports retain the default order used before draftType was stored.
  return { ...value, config: { ...value.config, draftType: value.config.draftType ?? 'snake' },
    revision: value.revision ?? 0, lineage: [...value.lineage ?? []], draftProgress,
    draftHistory: [...value.draftHistory], shortlistedPlayerIds: [...value.shortlistedPlayerIds],
    preloadedKeepers: [...value.preloadedKeepers], unresolvedProviderPicks: [...value.unresolvedProviderPicks] };
}
