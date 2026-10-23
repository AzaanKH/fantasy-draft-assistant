import { useSyncClockState } from '@/workspace/useSyncClockState';
import { isValidDraftSyncId, type DraftProvider } from '@fantasy-draft/shared/sync';
import { IS_DEMO } from '@/lib/demo-mode';
import {
  getDraftSynchronizationState,
  type DraftSyncController,
} from '@/lib/draft-sync-state';
import { useDraftSyncTransport } from './useDraftSyncTransport';
import { useDraftSyncReconciliation } from './useDraftSyncReconciliation';

export {
  getNextOpenPickNumber,
  resolveDraftPickImports,
} from '@fantasy-draft/shared/draft';
export {
  DRAFT_SYNC_STALE_AFTER_MS,
  getDraftSyncConnectionState,
  getDraftSynchronizationState,
  formatDraftSyncAge,
} from '@/lib/draft-sync-state';
export type {
  DraftSyncConnectionState,
  DraftSynchronizationState,
  DraftSyncViewState,
  DraftReconciliationSummary,
  DraftSyncController,
} from '@/lib/draft-sync-state';
export { isRequestedDraftSnapshot, applyDraftSyncHeartbeat } from './useDraftSyncTransport';

/**
 * The draft to sync, or null when there is none. The static demo has no sync
 * server, so it never syncs, whichever route (board or side panel) asks.
 */
export function getSyncedDraftId(
  provider: DraftProvider,
  requestedDraftId: string | null,
  demo: boolean = IS_DEMO
): string | null {
  return !demo && isValidDraftSyncId(provider, requestedDraftId) ? requestedDraftId : null;
}

/** Compose provider transport, canonical reconciliation, and connection status. */
export function useDraftSync(provider: DraftProvider, requestedDraftId: string | null, shouldImportPicks: boolean = true): DraftSyncController {
  const draftId = getSyncedDraftId(provider, requestedDraftId);
  const { snapshot, snapshotQuery, transportState, refresh } = useDraftSyncTransport(provider, draftId);
  const { importResult, importWarning, lastReconciledSnapshotAt, reconciliationSummary, dismissReconciliationSummary } = useDraftSyncReconciliation(provider, draftId, snapshot, shouldImportPicks);
  const myPicksCount = importResult.picks.filter(
    (pick) => pick.isMyPick
  ).length;

  const lastError = snapshot?.lastError ?? snapshotQuery.error?.message ?? null;
  const error = snapshot?.lastError
    ? new Error(snapshot.lastError)
    : snapshotQuery.error;
  const lastSuccessfulSyncAt = snapshot?.lastSuccessfulSyncAt ?? null;
  const lastSyncAgeMs = lastSuccessfulSyncAt === null
    ? null
    : Math.max(0, Date.now() - lastSuccessfulSyncAt);
  const connectionState = useSyncClockState({
    hasDraftId: Boolean(draftId),
    draftStatus: snapshot?.draft?.status ?? null,
    syncStatus: snapshot?.status ?? 'idle',
    transportState,
    lastSuccessfulSyncAt,
    isQueryLoading: snapshotQuery.isLoading && !snapshot,
    isQueryError: snapshotQuery.isError && !snapshot,
  });
  const synchronizationState = getDraftSynchronizationState(connectionState);

  return {
    provider,
    draft: snapshot?.draft ?? null,
    picks: snapshot?.picks ?? [],
    isLoading: snapshotQuery.isLoading && !snapshot,
    isError:
      (snapshotQuery.isError && !snapshot) ||
      snapshot?.status === 'error' ||
      connectionState === 'error',
    error,
    lastError,
    connectionState,
    synchronizationState,
    transportState,
    lastSuccessfulSyncAt,
    lastSyncAgeMs,
    syncStatus: snapshot?.status ?? 'idle',
    lastSyncedPick: importResult.picks.at(-1)?.pickNumber ?? 0,
    totalPicks: importResult.picks.length,
    myPicksCount,
    importWarning,
    rejectedPickCount: importResult.rejectedPicks.length,
    lastReconciledSnapshotAt,
    reconciliationSummary,
    dismissReconciliationSummary,
    refresh,
    isDrafting: snapshot?.draft?.status === 'drafting',
    isPaused: snapshot?.draft?.status === 'paused',
    isComplete: snapshot?.draft?.status === 'complete',
  };
}
