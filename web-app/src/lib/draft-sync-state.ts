import type {
  DraftProvider,
  DraftStatus,
  DraftSyncState,
  DraftSyncSnapshot,
} from '@fantasy-draft/shared';
import type {
  DraftPickCorrection,
  DraftPickRemoval,
  ProvisionalPickConfirmation,
  UnresolvedProviderPick,
} from '@/stores/draft/types';

export const DRAFT_SYNC_STALE_AFTER_MS = 15_000;

export type DraftSyncTransportState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type DraftSyncConnectionState =
  | 'disconnected'
  | 'syncing'
  | 'connected'
  | 'reconnecting'
  | 'stale'
  | 'error'
  | 'complete';

export type DraftSynchronizationState =
  | 'confirmed'
  | 'delayed'
  | 'disconnected'
  | 'manual-continuity'
  | 'reconciling'
  | 'complete';

export interface DraftSyncViewState {
  readonly connectionState: DraftSyncConnectionState;
  readonly synchronizationState: DraftSynchronizationState;
  readonly lastSuccessfulSyncAt: number | null;
  readonly lastSyncAgeMs: number | null;
  readonly lastError: string | null;
}

export interface DraftReconciliationSummary {
  readonly confirmedAt: number;
  readonly confirmations: readonly ProvisionalPickConfirmation[];
  readonly corrections: readonly DraftPickCorrection[];
  readonly removals: readonly DraftPickRemoval[];
  readonly unresolvedIdentities: readonly UnresolvedProviderPick[];
}

export interface DraftSyncController extends DraftSyncViewState {
  readonly provider: DraftProvider;
  readonly draft: DraftSyncSnapshot['draft'];
  readonly picks: DraftSyncSnapshot['picks'];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly transportState: DraftSyncTransportState;
  readonly syncStatus: DraftSyncState;
  readonly lastSyncedPick: number;
  readonly totalPicks: number;
  readonly myPicksCount: number;
  readonly importWarning: string | null;
  readonly rejectedPickCount: number;
  readonly lastReconciledSnapshotAt: number | null;
  readonly reconciliationSummary: DraftReconciliationSummary | null;
  readonly dismissReconciliationSummary: () => void;
  readonly refresh: () => Promise<void>;
  readonly isDrafting: boolean;
  readonly isPaused: boolean;
  readonly isComplete: boolean;
}

export function getDraftSynchronizationState(
  connectionState: DraftSyncConnectionState,
  isManualContinuity: boolean = false
): DraftSynchronizationState {
  if (isManualContinuity) return 'manual-continuity';

  switch (connectionState) {
    case 'connected':
      return 'confirmed';
    case 'reconnecting':
    case 'stale':
      return 'delayed';
    case 'syncing':
      return 'reconciling';
    case 'complete':
      return 'complete';
    case 'disconnected':
    case 'error':
      return 'disconnected';
  }
}

interface DraftSyncConnectionStateInput {
  readonly hasDraftId: boolean;
  readonly draftStatus: DraftStatus | null;
  readonly syncStatus: DraftSyncState;
  readonly transportState: DraftSyncTransportState;
  readonly lastSuccessfulSyncAt: number | null;
  readonly isQueryLoading: boolean;
  readonly isQueryError: boolean;
  readonly now: number;
  readonly staleAfterMs?: number;
}

export function getDraftSyncConnectionState({
  hasDraftId,
  draftStatus,
  syncStatus,
  transportState,
  lastSuccessfulSyncAt,
  isQueryLoading,
  isQueryError,
  now,
  staleAfterMs = DRAFT_SYNC_STALE_AFTER_MS,
}: DraftSyncConnectionStateInput): DraftSyncConnectionState {
  if (!hasDraftId) return 'disconnected';
  if (draftStatus === 'complete') return 'complete';
  if (
    isQueryError ||
    syncStatus === 'error' ||
    transportState === 'error'
  ) {
    return 'error';
  }

  const lastSyncAgeMs = lastSuccessfulSyncAt === null
    ? null
    : Math.max(0, now - lastSuccessfulSyncAt);
  if (transportState === 'reconnecting') return 'reconnecting';
  if (lastSyncAgeMs !== null && lastSyncAgeMs >= staleAfterMs) {
    return 'stale';
  }
  if (
    lastSuccessfulSyncAt === null ||
    isQueryLoading ||
    transportState === 'connecting' ||
    syncStatus === 'idle'
  ) {
    return 'syncing';
  }

  return 'connected';
}

export function formatDraftSyncAge(ageMs: number | null): string {
  if (ageMs === null) return 'not yet';

  const elapsedSeconds = Math.max(0, Math.floor(ageMs / 1_000));
  if (elapsedSeconds < 1) return 'just now';
  if (elapsedSeconds < 60) return `${String(elapsedSeconds)}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${String(elapsedMinutes)}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${String(elapsedHours)}h ago`;

  return `${String(Math.floor(elapsedHours / 24))}d ago`;
}

