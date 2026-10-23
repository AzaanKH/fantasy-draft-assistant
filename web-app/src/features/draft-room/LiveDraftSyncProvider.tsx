import { useWorkspace, useDraftState, useConnectionState } from '@/workspace/WorkspaceProvider';
import * as React from 'react';
import { useConnectionNotifications } from '@/hooks/useConnectionNotifications';
import {
  createDefaultLeagueSettings,
} from '@fantasy-draft/shared/league';
import {
  type DraftProvider,
} from '@fantasy-draft/shared/sync';
import {
  getDraftSynchronizationState,
  useDraftSync,
  type DraftSyncController,
  type DraftSynchronizationState,
  type DraftSyncViewState,
} from '@/hooks/useDraftSync';

import { getDraftSyncSearch, type PersistedDraftSyncConnection } from '@/stores/draftSyncStore';

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

export function LiveDraftSyncProvider({ children }: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const connection = useConnectionState((state) => state.connection);
  const manualContinuityBaselineAt = useDraftState((state) => state.manualContinuityBaselineAt);
  const workspace = useWorkspace();
  const lastConfirmedSyncAt = useDraftState((state) => state.lastConfirmedSyncAt);
  const lastConfirmedPickNumber = useDraftState((state) => state.lastConfirmedPickNumber);
  const [reconciliationTargetAt, setReconciliationTargetAt] =
    React.useState<number | null>(null);
  const isManualContinuity = manualContinuityBaselineAt !== null && reconciliationTargetAt === null;

  const provisionalPickCount = useDraftState((state) =>
    state.draftHistory.filter((pick) => pick.source === 'provisional').length
  );
  const isDraftPositionConfirmed =
    connection !== null && connection.draftPosition !== null;
  const sync = useDraftSync(
    connection?.provider ?? 'sleeper',
    connection?.draftId ?? null,
    isDraftPositionConfirmed && !isManualContinuity
  );

  useConnectionNotifications(
    connection ? `${connection.provider}:${connection.draftId}` : null,
    connection?.provider === 'sleeper' ? 'Sleeper' : connection?.provider === 'espn' ? 'ESPN' : 'Yahoo',
    sync.connectionState
  );

  const synchronizationState = reconciliationTargetAt === null
    ? getDraftSynchronizationState(sync.connectionState, isManualContinuity)
    : 'reconciling';
  const canEnterManualContinuity =
    !isManualContinuity &&
    connection?.provider === 'sleeper' &&
    connection.draftPosition !== null &&
    (sync.lastSuccessfulSyncAt ?? lastConfirmedSyncAt) !== null &&
    (
      sync.connectionState === 'reconnecting' ||
      sync.connectionState === 'stale' ||
      sync.connectionState === 'error'
    );

  React.useEffect(() => {
    syncConnectionToUrl(connection);
  }, [connection]);

  React.useEffect(() => {
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
  }, [reconciliationTargetAt, sync.lastReconciledSnapshotAt]);

  React.useEffect(() => {
    if (connection?.draftPosition === null || connection === null) return;

    workspace.send('setConfig', { myPickPosition: connection.draftPosition });
    workspace.send('setSessionMode', 'live');
  }, [connection, workspace]);

  React.useEffect(() => {
    if (sync.draft) workspace.send('setConfig', { draftType: sync.draft.type });
  }, [sync.draft, workspace]);

  const startConnection = React.useCallback((next: StartDraftConnectionInput) => {
    setReconciliationTargetAt(null);
    workspace.send('connection.startConnection', next.provider, next.draftId);
  }, [workspace]);

  const confirmDraftPosition = React.useCallback((draftPosition: number) => {
    setReconciliationTargetAt(null);
    workspace.send('connection.confirmDraftPosition', draftPosition);
    workspace.send('setConfig', { myPickPosition: draftPosition });
    workspace.send('setSessionMode', 'live');
  }, [workspace]);

  const enterManualContinuity = React.useCallback(() => {
    if (!canEnterManualContinuity) return;
    const baselineAt = sync.lastSuccessfulSyncAt ?? lastConfirmedSyncAt;
    if (baselineAt !== null) workspace.send('enterManualContinuity', baselineAt);
  }, [canEnterManualContinuity, sync.lastSuccessfulSyncAt, lastConfirmedSyncAt, workspace]);

  const disconnect = React.useCallback(() => {
    setReconciliationTargetAt(null);
    workspace.send('connection.disconnect');
    workspace.send('setConfig', { draftType: 'snake' });
    workspace.send('applyLeagueSettings', createDefaultLeagueSettings());
    workspace.send('resetDraft');
    workspace.send('setSessionMode', 'setup');
  }, [workspace]);

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
    lastConfirmedPickNumber,
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
    lastConfirmedPickNumber,
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
