import { useLeagueSetupStore } from '@/stores/leagueSetupStore';
/**
 * Provider-neutral Draft Integration Hook
 *
 * Consumes canonical draft sync state from the local sync server.
 * The server polls the selected provider, stores the latest snapshot, and pushes
 * updates to the app over SSE.
 */

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isDraftSyncSnapshot,
  isDraftSyncUpdate,
} from '@fantasy-draft/shared';
import type {
  DraftSyncSnapshot,
  DraftProvider,
  DraftStatus,
  DraftSyncState,
  DraftSyncUpdate,
} from '@fantasy-draft/shared';
import { useDraftStore } from '@/stores/draftStore';
import { isValidDraftSyncId, useDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { resolveSyncedLeagueSettings } from '@/lib/synced-league-settings';
import type {
  DraftPickCorrection,
  DraftPickRemoval,
  ProvisionalPickConfirmation,
  UnresolvedProviderPick,
} from '@/stores/draftStore';
import { getNextOpenPickNumber, resolveDraftPickImports, type DraftPickImportRejection, type DraftPickImportResult } from '@/lib/draft-pick-imports';
export { getNextOpenPickNumber, resolveDraftPickImports, type DraftPickImportRejection, type DraftPickImportResult } from '@/lib/draft-pick-imports';
import { usePlayerDataQuery } from './usePlayerData';

const EMPTY_IMPORT_RESULT: DraftPickImportResult = {
  picks: [],
  rejectedPicks: [],
};

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

function getSyncPath(provider: DraftProvider, draftId: string): string {
  return `/api/sync/${provider}/drafts/${encodeURIComponent(draftId)}`;
}

export function isRequestedDraftSnapshot(
  snapshot: unknown,
  provider: DraftProvider,
  draftId: string
): snapshot is DraftSyncSnapshot {
  return isDraftSyncSnapshot(snapshot) &&
    snapshot.provider === provider && snapshot.draftId === draftId;
}

export function applyDraftSyncHeartbeat(
  snapshot: DraftSyncSnapshot | null,
  heartbeat: Extract<DraftSyncUpdate, { type: 'heartbeat' }>,
  provider: DraftProvider,
  draftId: string
): DraftSyncSnapshot | null {
  if (
    !snapshot ||
    heartbeat.provider !== provider || heartbeat.draftId !== draftId ||
    snapshot.provider !== provider || snapshot.draftId !== draftId ||
    (snapshot.lastSuccessfulSyncAt !== null &&
      heartbeat.lastSuccessfulSyncAt < snapshot.lastSuccessfulSyncAt)
  ) {
    return snapshot;
  }

  if (
    snapshot.status === 'synced' && snapshot.lastError === null &&
    snapshot.lastPolledAt === heartbeat.lastPolledAt &&
    snapshot.lastSuccessfulSyncAt === heartbeat.lastSuccessfulSyncAt
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    status: 'synced',
    lastPolledAt: heartbeat.lastPolledAt,
    lastSuccessfulSyncAt: heartbeat.lastSuccessfulSyncAt,
    lastError: null,
  };
}

function selectLatestDraftSnapshot(
  current: DraftSyncSnapshot | null | undefined,
  incoming: DraftSyncSnapshot
): DraftSyncSnapshot {
  // A refresh response can arrive after a newer stream event. Poll time also
  // orders errors and syncing states that have no new successful sync time.
  if (
    current?.provider === incoming.provider &&
    current.draftId === incoming.draftId &&
    (
      (incoming.lastSuccessfulSyncAt ?? -Infinity) < (current.lastSuccessfulSyncAt ?? -Infinity) ||
      (incoming.lastPolledAt ?? -Infinity) < (current.lastPolledAt ?? -Infinity)
    )
  ) {
    return current;
  }
  return incoming;
}

async function readDraftSnapshot(
  response: Response,
  provider: DraftProvider,
  draftId: string
): Promise<DraftSyncSnapshot> {
  const parsed: unknown = await response.json();
  if (!isRequestedDraftSnapshot(parsed, provider, draftId)) {
    throw new Error('Sync server returned an invalid draft snapshot');
  }
  return parsed;
}

async function fetchDraftSnapshot(
  provider: DraftProvider,
  draftId: string
): Promise<DraftSyncSnapshot> {
  const response = await fetch(getSyncPath(provider, draftId));
  if (!response.ok) {
    throw new Error(`Failed to fetch draft snapshot: ${response.status}`);
  }

  return readDraftSnapshot(response, provider, draftId);
}

async function requestRefresh(
  provider: DraftProvider,
  draftId: string
): Promise<DraftSyncSnapshot> {
  const response = await fetch(`${getSyncPath(provider, draftId)}/refresh`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to refresh draft snapshot: ${response.status}`);
  }

  return readDraftSnapshot(response, provider, draftId);
}

function getImportWarning(
  rejectedPicks: readonly DraftPickImportRejection[]
): string | null {
  if (rejectedPicks.length === 0) {
    return null;
  }

  const examples = rejectedPicks
    .slice(0, 3)
    .map((pick) => `#${String(pick.pickNumber)} ${pick.playerName}`)
    .join(', ');
  const remaining =
    rejectedPicks.length > 3
      ? `, and ${String(rejectedPicks.length - 3)} more`
      : '';
  const subject =
    rejectedPicks.length === 1
      ? 'This pick was'
      : 'These picks were';

  return `${String(rejectedPicks.length)} ${
    rejectedPicks.length === 1 ? 'pick was' : 'picks were'
  } not imported because Provider Truth could not map the player to canonical identity data (${examples}${remaining}). ${subject} excluded from roster and availability calculations. Live recommendations stay off until player identities are refreshed and the provider sync succeeds.`;
}

export function useDraftSync(
  provider: DraftProvider,
  requestedDraftId: string | null,
  shouldImportPicks: boolean = true
): DraftSyncController {
  const draftId = isValidDraftSyncId(provider, requestedDraftId) ? requestedDraftId : null;
  const quickMockPreferences = useLeagueSetupStore((state) => state.quickMock);
  const useQuickMockSettings = useDraftSyncConnectionStore((state) =>
    state.connection?.provider === provider && state.connection.draftId === draftId && state.connection.settingsProfile === 'quick-mock'
  );
  const usePrimaryLeagueSettings = useDraftSyncConnectionStore((state) =>
    provider === 'sleeper' && state.connection?.provider === provider &&
    state.connection.draftId === draftId && state.connection.usePrimaryLeagueSettings === true
  );
  const queryClient = useQueryClient();
  const {
    players,
    isLoading: isPlayerDataLoading,
  } = usePlayerDataQuery();
  const [liveSnapshot, setLiveSnapshot] = useState<DraftSyncSnapshot | null>(null);
  const [transportState, setTransportState] = useState<DraftSyncTransportState>(
    draftId ? 'connecting' : 'disconnected'
  );
  const [lastReconciledSnapshotAt, setLastReconciledSnapshotAt] = useState<
    number | null
  >(null);
  const [reconciliationSummary, setReconciliationSummary] = useState<
    DraftReconciliationSummary | null
  >(null);
  const [now, setNow] = useState(() => Date.now());
  const lastImported = useRef<{
    draftId: string;
    picks: DraftSyncSnapshot['picks'];
    importedPicks: DraftPickImportResult['picks'];
    rejectedPicks: DraftPickImportResult['rejectedPicks'];
    nextOpenPickNumber: number;
  } | null>(null);
  const reconcileSyncedPicks = useDraftStore((state) => state.reconcileSyncedPicks);
  const myPickPosition = useDraftStore((state) => state.config.myPickPosition);
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const setConfig = useDraftStore((state) => state.setConfig);
  const applyLeagueSettings = useDraftStore((state) => state.applyLeagueSettings);

  const snapshotQuery = useQuery({
    queryKey: ['draft-sync-snapshot', provider, draftId],
    queryFn: async () => {
      if (!draftId) {
        throw new Error('A draft ID is required to fetch a draft snapshot');
      }
      return fetchDraftSnapshot(provider, draftId);
    },
    enabled: Boolean(draftId),
    staleTime: 1000,
  });

  useEffect(() => {
    if (!draftId) {
      setLiveSnapshot(null);
      setTransportState('disconnected');
      return;
    }

    setTransportState('connecting');
    const eventSource = new EventSource(
      `${getSyncPath(provider, draftId)}/events`
    );

    eventSource.onopen = () => {
      setTransportState('connected');
    };

    eventSource.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (!isDraftSyncUpdate(parsed)) {
          return;
        }
        const update = parsed;
        if (update.type === 'heartbeat') {
          if (update.provider !== provider || update.draftId !== draftId) return;
          setTransportState('connected');
          setLiveSnapshot((current) =>
            applyDraftSyncHeartbeat(current, update, provider, draftId)
          );
          queryClient.setQueryData<DraftSyncSnapshot>(
            ['draft-sync-snapshot', provider, draftId],
            (current) => applyDraftSyncHeartbeat(
              current ?? null, update, provider, draftId
            ) ?? current
          );
          return;
        }
        if (!isRequestedDraftSnapshot(update.snapshot, provider, draftId)) {
          return;
        }
        setTransportState('connected');
        setLiveSnapshot(update.snapshot);
        queryClient.setQueryData(
          ['draft-sync-snapshot', provider, draftId],
          update.snapshot
        );
      } catch {
        // Ignore a malformed event; EventSource remains connected and can
        // recover on the next canonical snapshot.
      }
    };

    eventSource.onerror = () => {
      // EventSource normally reconnects on its own. Surface that transition so
      // cached draft data is never mistaken for a healthy live connection.
      setTransportState('reconnecting');
    };

    return () => {
      eventSource.close();
    };
  }, [draftId, provider, queryClient]);

  useEffect(() => {
    setLastReconciledSnapshotAt(null);
    setReconciliationSummary(null);
  }, [draftId, provider]);

  useEffect(() => {
    if (!draftId) return;

    setNow(Date.now());
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [draftId]);

  const snapshot =
    liveSnapshot?.draftId === draftId && liveSnapshot.provider === provider
      ? liveSnapshot
      : snapshotQuery.data ?? null;

  useEffect(() => {
    if (!snapshot?.draft) {
      return;
    }

    setConfig({
      totalTeams: snapshot.draft.settings.teams,
      totalRounds: snapshot.draft.settings.rounds,
      draftType: snapshot.draft.type,
    });
    applyLeagueSettings(resolveSyncedLeagueSettings(
      provider,
      snapshot.draft.settings.teams,
      snapshot.draft.leagueSettings,
      usePrimaryLeagueSettings,
      useQuickMockSettings ? { ...quickMockPreferences, totalRounds: snapshot.draft.settings.rounds } : undefined,
    ));
  }, [applyLeagueSettings, setConfig, snapshot?.draft, provider, usePrimaryLeagueSettings, useQuickMockSettings, quickMockPreferences]);

  const pickHistory = snapshot?.picks;
  const draftSettings = snapshot?.draft?.settings;
  const draftType = snapshot?.draft?.type;

  const importResult = useMemo(() => {
    if (!pickHistory || isPlayerDataLoading) {
      return EMPTY_IMPORT_RESULT;
    }

    return resolveDraftPickImports(
      pickHistory,
      players,
      myPickPosition,
      preloadedKeepers,
      totalTeams,
      draftType
    );
  }, [
    pickHistory,
    isPlayerDataLoading,
    players,
    myPickPosition,
    preloadedKeepers,
    totalTeams,
    draftType,
  ]);

  const nextOpenPickNumber = useMemo(() => {
    if (!pickHistory || !draftSettings) {
      return 1;
    }

    return getNextOpenPickNumber(
      pickHistory,
      draftSettings.teams * draftSettings.rounds
    );
  }, [pickHistory, draftSettings]);

  useEffect(() => {
    if (
      !snapshot ||
      snapshot.status !== 'synced' ||
      snapshot.lastSuccessfulSyncAt === null ||
      !shouldImportPicks ||
      isPlayerDataLoading
    ) {
      lastImported.current = null;
      return;
    }

    const previousImport = lastImported.current;
    if (
      previousImport?.draftId === draftId &&
      previousImport.picks === snapshot.picks &&
      previousImport.importedPicks === importResult.picks &&
      previousImport.rejectedPicks === importResult.rejectedPicks &&
      previousImport.nextOpenPickNumber === nextOpenPickNumber
    ) {
      setLastReconciledSnapshotAt(snapshot.lastSuccessfulSyncAt);
      return;
    }

    const reconciliation = reconcileSyncedPicks(
      importResult.picks,
      nextOpenPickNumber,
      importResult.rejectedPicks
    );
    lastImported.current = {
      draftId: snapshot.draftId,
      picks: snapshot.picks,
      importedPicks: importResult.picks,
      rejectedPicks: importResult.rejectedPicks,
      nextOpenPickNumber,
    };
    const hasVisibleOutcome =
      reconciliation.confirmations.length > 0 ||
      reconciliation.corrections.length > 0 ||
      reconciliation.removals.length > 0 ||
      reconciliation.unresolvedIdentities.length > 0;
    if (hasVisibleOutcome) {
      setReconciliationSummary({
        confirmedAt: snapshot.lastSuccessfulSyncAt,
        confirmations: reconciliation.confirmations,
        corrections: reconciliation.corrections,
        removals: reconciliation.removals,
        unresolvedIdentities: importResult.rejectedPicks,
      });
    } else if (
      reconciliation.changed &&
      importResult.rejectedPicks.length === 0
    ) {
      setReconciliationSummary((current) =>
        current && current.unresolvedIdentities.length > 0 ? null : current
      );
    }
    setLastReconciledSnapshotAt(snapshot.lastSuccessfulSyncAt);
  }, [
    draftId,
    snapshot,
    shouldImportPicks,
    isPlayerDataLoading,
    importResult.picks,
    importResult.rejectedPicks,
    nextOpenPickNumber,
    reconcileSyncedPicks,
  ]);

  const dismissReconciliationSummary = useCallback(() => {
    setReconciliationSummary(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!draftId) {
      return;
    }

    const refreshedSnapshot = await requestRefresh(provider, draftId);
    setLiveSnapshot((current) => selectLatestDraftSnapshot(current, refreshedSnapshot));
    queryClient.setQueryData<DraftSyncSnapshot>(
      ['draft-sync-snapshot', provider, draftId],
      (current) => selectLatestDraftSnapshot(current, refreshedSnapshot)
    );
  }, [draftId, provider, queryClient]);

  const myPicksCount = importResult.picks.filter(
    (pick) => pick.isMyPick
  ).length;
  const importWarning = getImportWarning(importResult.rejectedPicks);

  const lastError = snapshot?.lastError ?? snapshotQuery.error?.message ?? null;
  const error = snapshot?.lastError
    ? new Error(snapshot.lastError)
    : snapshotQuery.error;
  const lastSuccessfulSyncAt = snapshot?.lastSuccessfulSyncAt ?? null;
  const lastSyncAgeMs = lastSuccessfulSyncAt === null
    ? null
    : Math.max(0, now - lastSuccessfulSyncAt);
  const connectionState = getDraftSyncConnectionState({
    hasDraftId: Boolean(draftId),
    draftStatus: snapshot?.draft?.status ?? null,
    syncStatus: snapshot?.status ?? 'idle',
    transportState,
    lastSuccessfulSyncAt,
    isQueryLoading: snapshotQuery.isLoading && !snapshot,
    isQueryError: snapshotQuery.isError && !snapshot,
    now,
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
