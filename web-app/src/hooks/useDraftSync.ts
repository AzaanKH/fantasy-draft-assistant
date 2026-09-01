/**
 * Provider-neutral Draft Integration Hook
 *
 * Consumes canonical draft sync state from the local sync server.
 * The server polls the selected provider, stores the latest snapshot, and pushes
 * updates to the app over SSE.
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isDraftSyncSnapshot,
  isDraftSyncUpdate,
} from '@fantasy-draft/shared';
import type {
  DraftSyncSnapshot,
  DraftPickEvent,
  DraftProvider,
  DraftStatus,
  DraftSyncState,
  Player,
} from '@fantasy-draft/shared';
import { useDraftStore } from '@/stores/draftStore';
import type {
  DraftPickCorrection,
  DraftPickRemoval,
  PreloadedKeeper,
  ProvisionalPickConfirmation,
  SyncedImportedPick,
  UnresolvedProviderPick,
} from '@/stores/draftStore';
import { getPickNumberForTeamRound } from '@/lib/mock-draft-engine';
import { usePlayerDataQuery } from './usePlayerData';

export type DraftPickImportRejection = UnresolvedProviderPick;

export interface DraftPickImportResult {
  readonly picks: readonly SyncedImportedPick[];
  readonly rejectedPicks: readonly DraftPickImportRejection[];
}

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

export interface DraftSyncController {
  readonly provider: DraftProvider;
  readonly draft: DraftSyncSnapshot['draft'];
  readonly picks: DraftSyncSnapshot['picks'];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly lastError: string | null;
  readonly connectionState: DraftSyncConnectionState;
  readonly synchronizationState: DraftSynchronizationState;
  readonly transportState: DraftSyncTransportState;
  readonly lastSuccessfulSyncAt: number | null;
  readonly lastSyncAgeMs: number | null;
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

async function readDraftSnapshot(
  response: Response,
  provider: DraftProvider,
  draftId: string
): Promise<DraftSyncSnapshot> {
  const parsed: unknown = await response.json();
  if (
    !isDraftSyncSnapshot(parsed) ||
    parsed.provider !== provider ||
    parsed.draftId !== draftId
  ) {
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

const DRAFT_TEAM_ALIASES: Readonly<Record<string, string>> = {
  JAC: 'JAX',
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LAR',
  WSH: 'WAS',
};

function getNormalizedPlayerName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\.?$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function getNameTeamKey(name: string, team: string): string {
  const normalizedTeam = team.trim().toUpperCase();
  const canonicalTeam = DRAFT_TEAM_ALIASES[normalizedTeam] ?? normalizedTeam;
  const normalizedName = getNormalizedPlayerName(name);
  return `${normalizedName}|${canonicalTeam}`;
}

function usesCanonicalPlayerIds(pick: DraftPickEvent): boolean {
  // The app's canonical player IDs come from Sleeper. ESPN and Yahoo IDs can
  // be numeric too, but they belong to different namespaces and can collide
  // with an unrelated Sleeper player.
  return pick.source === 'sleeper-api' || pick.source === 'manual';
}

/**
 * Sleeper includes reserved keeper selections in its picks response before the
 * draft reaches them. The active selection is therefore the first unfilled
 * slot, not one after the largest pick number in the payload.
 */
export function getNextOpenPickNumber(
  picks: readonly DraftPickEvent[],
  totalPicks: number
): number {
  const filledPickNumbers = new Set(
    picks
      .map((pick) => pick.pickNumber)
      .filter((pickNumber) =>
        Number.isInteger(pickNumber) &&
        pickNumber >= 1 &&
        pickNumber <= totalPicks
      )
  );

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber += 1) {
    if (!filledPickNumbers.has(pickNumber)) {
      return pickNumber;
    }
  }

  return totalPicks + 1;
}

/**
 * Resolves nullable provider positions from local player identity data. Picks
 * that still lack a position are deliberately omitted from the store.
 */
export function resolveDraftPickImports(
  picks: readonly DraftPickEvent[],
  players: readonly Player[],
  myPickPosition: number,
  preloadedKeepers: readonly PreloadedKeeper[] = [],
  totalTeams: number = 0
): DraftPickImportResult {
  const playersById = new Map<string, Player>();
  const playersByNameTeam = new Map<string, Player>();
  const playersByUniqueName = new Map<string, Player>();
  const ambiguousNames = new Set<string>();
  const importedPicks: SyncedImportedPick[] = [];
  const rejectedPicks: DraftPickImportRejection[] = [];
  const preloadedKeeperKeys = new Set(
    totalTeams > 0
      ? preloadedKeepers.map((keeper) => `${keeper.playerId}:${String(
        getPickNumberForTeamRound(
          keeper.teamIndex,
          keeper.round,
          totalTeams
        )
      )}`)
      : []
  );

  for (const player of players) {
    playersById.set(player.id, player);
    playersByNameTeam.set(
      getNameTeamKey(player.name, player.team),
      player
    );
    const normalizedName = getNormalizedPlayerName(player.name);
    if (playersByUniqueName.has(normalizedName)) {
      playersByUniqueName.delete(normalizedName);
      ambiguousNames.add(normalizedName);
    } else if (!ambiguousNames.has(normalizedName)) {
      playersByUniqueName.set(normalizedName, player);
    }
  }

  for (const pick of picks) {
    const matchedByNameTeam = pick.nflTeam
      ? playersByNameTeam.get(
        getNameTeamKey(pick.playerName, pick.nflTeam)
      )
      : undefined;
    const matchedByUniqueName = playersByUniqueName.get(
      getNormalizedPlayerName(pick.playerName)
    );
    const matchedByCanonicalId = usesCanonicalPlayerIds(pick)
      ? playersById.get(pick.playerId)
      : undefined;
    const matchedPlayer =
      matchedByNameTeam ?? (
        usesCanonicalPlayerIds(pick)
          ? matchedByCanonicalId ?? matchedByUniqueName
          : matchedByUniqueName
      );

    if (!matchedPlayer) {
      rejectedPicks.push({
        pickNumber: pick.pickNumber,
        playerId: pick.playerId,
        playerName: pick.playerName,
        nflTeam: pick.nflTeam,
      });
      continue;
    }

    // Exact keeper matches are already reserved by useKeeperPreload. A provider
    // keeper at another slot is a real conflict and must reach reconciliation.
    if (
      pick.isKeeper &&
      preloadedKeeperKeys.has(`${matchedPlayer.id}:${String(pick.pickNumber)}`)
    ) {
      continue;
    }

    const isMyPick = pick.draftSlot === myPickPosition;
    importedPicks.push({
      pickNumber: pick.pickNumber,
      playerId: matchedPlayer.id,
      playerName: matchedPlayer.name,
      position: matchedPlayer.position,
      nflTeam: matchedPlayer.team,
      teamIndex: pick.teamIndex,
      teamName: isMyPick ? 'My Team' : `Team ${String(pick.draftSlot)}`,
      isMyPick,
    });
  }

  return {
    picks: importedPicks,
    rejectedPicks,
  };
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
  draftId: string | null,
  shouldImportPicks: boolean = true
): DraftSyncController {
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
    });
    if (snapshot.draft.leagueSettings) {
      applyLeagueSettings(snapshot.draft.leagueSettings);
    }
  }, [applyLeagueSettings, setConfig, snapshot?.draft]);

  const importResult = useMemo(() => {
    if (
      !snapshot ||
      isPlayerDataLoading
    ) {
      return EMPTY_IMPORT_RESULT;
    }

    return resolveDraftPickImports(
      snapshot.picks,
      players,
      myPickPosition,
      preloadedKeepers,
      totalTeams
    );
  }, [
    snapshot,
    isPlayerDataLoading,
    players,
    myPickPosition,
    preloadedKeepers,
    totalTeams,
  ]);

  const nextOpenPickNumber = useMemo(() => {
    if (!snapshot?.draft) {
      return 1;
    }

    return getNextOpenPickNumber(
      snapshot.picks,
      snapshot.draft.settings.teams * snapshot.draft.settings.rounds
    );
  }, [snapshot]);

  useEffect(() => {
    if (
      !snapshot ||
      snapshot.status !== 'synced' ||
      snapshot.lastSuccessfulSyncAt === null ||
      !shouldImportPicks ||
      isPlayerDataLoading
    ) {
      return;
    }

    const reconciliation = reconcileSyncedPicks(
      importResult.picks,
      nextOpenPickNumber,
      importResult.rejectedPicks
    );
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
    setLiveSnapshot(refreshedSnapshot);
    queryClient.setQueryData(
      ['draft-sync-snapshot', provider, draftId],
      refreshedSnapshot
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
