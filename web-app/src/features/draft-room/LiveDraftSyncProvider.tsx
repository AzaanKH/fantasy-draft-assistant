import * as React from 'react';
import {
  createDefaultLeagueSettings,
  type DraftProvider,
} from '@fantasy-draft/shared';
import {
  getDraftSynchronizationState,
  useDraftSync,
  type DraftSynchronizationState,
  type DraftSyncViewState,
} from '@/hooks/useDraftSync';
import { useDraftStore } from '@/stores/draftStore';
import {
  getDraftSyncSearch,
  useDraftSyncConnectionStore,
  type PersistedDraftSyncConnection,
} from '@/stores/draftSyncStore';

type DraftSyncController = ReturnType<typeof useDraftSync>;

interface StartDraftConnectionInput {
  readonly provider: DraftProvider;
  readonly draftId: string;
}

interface RestoredProviderTruthInput {
  readonly provider: DraftProvider | null;
  readonly isManualContinuity: boolean;
  readonly connectionState: DraftSyncController['connectionState'];
  readonly syncStatus: DraftSyncController['syncStatus'];
  readonly lastSuccessfulSyncAt: number | null;
  readonly manualContinuityBaselineAt: number | null;
}

export function getRestoredProviderTruthSnapshotAt({
  provider,
  isManualContinuity,
  connectionState,
  syncStatus,
  lastSuccessfulSyncAt,
  manualContinuityBaselineAt,
}: RestoredProviderTruthInput): number | null {
  if (
    provider !== 'sleeper' ||
    !isManualContinuity ||
    (connectionState !== 'connected' && connectionState !== 'complete') ||
    syncStatus !== 'synced' ||
    lastSuccessfulSyncAt === null ||
    manualContinuityBaselineAt === null ||
    lastSuccessfulSyncAt <= manualContinuityBaselineAt
  ) {
    return null;
  }

  return lastSuccessfulSyncAt;
}

interface LiveDraftSyncContextValue {
  readonly connection: PersistedDraftSyncConnection | null;
  readonly sync: DraftSyncController;
  readonly viewState: DraftSyncViewState;
  readonly synchronizationState: DraftSynchronizationState;
  readonly canEnterManualContinuity: boolean;
  readonly lastConfirmedPickNumber: number;
  readonly provisionalPickCount: number;
  startConnection: (connection: StartDraftConnectionInput) => void;
  confirmDraftPosition: (draftPosition: number) => void;
  enterManualContinuity: () => void;
  disconnect: () => void;
}

const LiveDraftSyncContext = React.createContext<LiveDraftSyncContextValue | null>(
  null
);

function syncConnectionToUrl(
  connection: PersistedDraftSyncConnection | null
): void {
  const nextSearch = getDraftSyncSearch(window.location.search, connection);
  const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, '', nextUrl);
  }
}

export function LiveDraftSyncProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const connection = useDraftSyncConnectionStore((state) => state.connection);
  const persistStartConnection = useDraftSyncConnectionStore(
    (state) => state.startConnection
  );
  const persistDraftPosition = useDraftSyncConnectionStore(
    (state) => state.confirmDraftPosition
  );
  const clearConnection = useDraftSyncConnectionStore((state) => state.disconnect);
  const [isManualContinuity, setIsManualContinuity] = React.useState(false);
  const [manualContinuityBaselineAt, setManualContinuityBaselineAt] =
    React.useState<number | null>(null);
  const [reconciliationTargetAt, setReconciliationTargetAt] =
    React.useState<number | null>(null);
  const applyLeagueSettings = useDraftStore((state) => state.applyLeagueSettings);
  const resetDraft = useDraftStore((state) => state.resetDraft);
  const setConfig = useDraftStore((state) => state.setConfig);
  const setSessionMode = useDraftStore((state) => state.setSessionMode);
  const provisionalPickCount = useDraftStore((state) =>
    state.draftHistory.filter((pick) => pick.source === 'provisional').length
  );
  const isDraftPositionConfirmed =
    connection !== null && connection.draftPosition !== null;
  const sync = useDraftSync(
    connection?.provider ?? 'sleeper',
    connection?.draftId ?? null,
    isDraftPositionConfirmed && !isManualContinuity
  );

  const synchronizationState = reconciliationTargetAt === null
    ? getDraftSynchronizationState(sync.connectionState, isManualContinuity)
    : 'reconciling';
  const canEnterManualContinuity =
    !isManualContinuity &&
    connection?.provider === 'sleeper' &&
    connection.draftPosition !== null &&
    sync.lastSuccessfulSyncAt !== null &&
    (
      sync.connectionState === 'reconnecting' ||
      sync.connectionState === 'stale' ||
      sync.connectionState === 'error'
    );

  React.useEffect(() => {
    syncConnectionToUrl(connection);
  }, [connection]);

  React.useEffect(() => {
    setIsManualContinuity(false);
    setManualContinuityBaselineAt(null);
    setReconciliationTargetAt(null);
  }, [connection?.draftId, connection?.provider]);

  React.useEffect(() => {
    const restoredSnapshotAt = getRestoredProviderTruthSnapshotAt({
      provider: connection?.provider ?? null,
      isManualContinuity,
      connectionState: sync.connectionState,
      syncStatus: sync.syncStatus,
      lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt,
      manualContinuityBaselineAt,
    });
    if (restoredSnapshotAt === null) return;

    setReconciliationTargetAt(restoredSnapshotAt);
    setIsManualContinuity(false);
  }, [
    connection?.provider,
    isManualContinuity,
    manualContinuityBaselineAt,
    sync.connectionState,
    sync.lastSuccessfulSyncAt,
    sync.syncStatus,
  ]);

  React.useEffect(() => {
    if (
      reconciliationTargetAt === null ||
      sync.lastReconciledSnapshotAt === null ||
      sync.lastReconciledSnapshotAt < reconciliationTargetAt
    ) {
      return;
    }

    setReconciliationTargetAt(null);
    setManualContinuityBaselineAt(null);
  }, [reconciliationTargetAt, sync.lastReconciledSnapshotAt]);

  React.useEffect(() => {
    if (connection?.draftPosition === null || connection === null) return;

    setConfig({ myPickPosition: connection.draftPosition });
    setSessionMode('live');
  }, [connection, setConfig, setSessionMode]);

  const startConnection = React.useCallback((next: StartDraftConnectionInput) => {
    setIsManualContinuity(false);
    setManualContinuityBaselineAt(null);
    setReconciliationTargetAt(null);
    persistStartConnection(next.provider, next.draftId);
    setSessionMode('setup');
  }, [persistStartConnection, setSessionMode]);

  const confirmDraftPosition = React.useCallback((draftPosition: number) => {
    setIsManualContinuity(false);
    setManualContinuityBaselineAt(null);
    setReconciliationTargetAt(null);
    persistDraftPosition(draftPosition);
    setConfig({ myPickPosition: draftPosition });
    setSessionMode('live');
  }, [persistDraftPosition, setConfig, setSessionMode]);

  const enterManualContinuity = React.useCallback(() => {
    if (!canEnterManualContinuity) return;
    setManualContinuityBaselineAt(sync.lastSuccessfulSyncAt);
    setIsManualContinuity(true);
  }, [canEnterManualContinuity, sync.lastSuccessfulSyncAt]);

  const disconnect = React.useCallback(() => {
    setIsManualContinuity(false);
    setManualContinuityBaselineAt(null);
    setReconciliationTargetAt(null);
    clearConnection();
    applyLeagueSettings(createDefaultLeagueSettings());
    resetDraft();
    setSessionMode('setup');
  }, [applyLeagueSettings, clearConnection, resetDraft, setSessionMode]);

  const viewState = React.useMemo<DraftSyncViewState>(() => ({
    connectionState: sync.connectionState,
    synchronizationState,
    lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt,
    lastSyncAgeMs: sync.lastSyncAgeMs,
    lastError: sync.lastError,
  }), [
    sync.connectionState,
    sync.lastError,
    sync.lastSuccessfulSyncAt,
    sync.lastSyncAgeMs,
    synchronizationState,
  ]);

  const value = React.useMemo<LiveDraftSyncContextValue>(() => ({
    connection,
    sync,
    viewState,
    synchronizationState,
    canEnterManualContinuity,
    lastConfirmedPickNumber: sync.lastSyncedPick,
    provisionalPickCount,
    startConnection,
    confirmDraftPosition,
    enterManualContinuity,
    disconnect,
  }), [
    connection,
    canEnterManualContinuity,
    confirmDraftPosition,
    disconnect,
    enterManualContinuity,
    provisionalPickCount,
    startConnection,
    sync,
    synchronizationState,
    viewState,
  ]);

  return (
    <LiveDraftSyncContext.Provider value={value}>
      {children}
    </LiveDraftSyncContext.Provider>
  );
}

export function useLiveDraftSync(): LiveDraftSyncContextValue {
  const context = React.useContext(LiveDraftSyncContext);
  if (!context) {
    throw new Error('useLiveDraftSync must be used inside LiveDraftSyncProvider');
  }
  return context;
}
