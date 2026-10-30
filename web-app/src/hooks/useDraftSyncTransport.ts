import { requestJson } from '@/lib/http';
import { decodeDraftSyncSnapshot, decodeDraftSyncUpdate, decodeOrNull } from '@fantasy-draft/shared/catalog';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type DraftProvider,
  type DraftSyncSnapshot,
  type DraftSyncUpdate,
} from '@fantasy-draft/shared/sync';
import type { DraftSyncTransportState } from '@/lib/draft-sync-state';

function getSyncPath(provider: DraftProvider, draftId: string): string {
  return `/api/sync/${provider}/drafts/${encodeURIComponent(draftId)}`;
}

export function isRequestedDraftSnapshot(
  snapshot: unknown,
  provider: DraftProvider,
  draftId: string
): snapshot is DraftSyncSnapshot {
  const decoded = decodeOrNull(decodeDraftSyncSnapshot, snapshot);
  return decoded !== null && decoded.provider === provider && decoded.draftId === draftId;
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

function isStaleSnapshot(
  current: DraftSyncSnapshot,
  incoming: DraftSyncSnapshot
): boolean {
  return current.provider === incoming.provider &&
    current.draftId === incoming.draftId &&
    (
      (incoming.lastSuccessfulSyncAt ?? -Infinity) < (current.lastSuccessfulSyncAt ?? -Infinity) ||
      (incoming.lastPolledAt ?? -Infinity) < (current.lastPolledAt ?? -Infinity)
    );
}

function selectLatestDraftSnapshot(
  current: DraftSyncSnapshot | null | undefined,
  incoming: DraftSyncSnapshot
): DraftSyncSnapshot {
  return current && isStaleSnapshot(current, incoming) ? current : incoming;
}

function readDraftSnapshot(
  parsed: unknown,
  provider: DraftProvider,
  draftId: string
): DraftSyncSnapshot {
  const snapshot = decodeOrNull(decodeDraftSyncSnapshot, parsed);
  if (!snapshot || snapshot.provider !== provider || snapshot.draftId !== draftId) {
    console.warn('[draft-sync] Rejected invalid draft snapshot');
    throw new Error('Sync server returned an invalid draft snapshot');
  }
  return snapshot;
}

async function fetchDraftSnapshot(
  provider: DraftProvider,
  draftId: string
): Promise<DraftSyncSnapshot> {
  return requestJson(getSyncPath(provider, draftId),
    parsed => readDraftSnapshot(parsed, provider, draftId), 'Failed to fetch draft snapshot');
}

async function requestRefresh(
  provider: DraftProvider,
  draftId: string
): Promise<DraftSyncSnapshot> {
  return requestJson(`${getSyncPath(provider, draftId)}/refresh`,
    parsed => readDraftSnapshot(parsed, provider, draftId), 'Failed to refresh draft snapshot',
    { init: { method: 'POST' } });
}

interface DraftSyncTransport {
  readonly snapshot: DraftSyncSnapshot | null;
  readonly snapshotQuery: UseQueryResult<DraftSyncSnapshot>;
  readonly transportState: DraftSyncTransportState;
  readonly refresh: () => Promise<void>;
}

export function useDraftSyncTransport(provider: DraftProvider, draftId: string | null): DraftSyncTransport {
  const queryClient = useQueryClient();
  const [liveSnapshot, setLiveSnapshot] = useState<DraftSyncSnapshot | null>(null);
  const [transportState, setTransportState] = useState<DraftSyncTransportState>(
    draftId ? 'connecting' : 'disconnected'
  );
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
        const update = decodeDraftSyncUpdate(parsed);
        if (update.type === 'heartbeat') {
          if (update.provider !== provider || update.draftId !== draftId) throw new Error('Heartbeat session mismatch');
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
        if (update.snapshot.provider !== provider || update.snapshot.draftId !== draftId) throw new Error('Snapshot session mismatch');
        setTransportState('connected');
        setLiveSnapshot(update.snapshot);
        queryClient.setQueryData(
          ['draft-sync-snapshot', provider, draftId],
          update.snapshot
        );
      } catch {
        console.warn('[draft-sync] Rejected invalid draft event');
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

  const snapshot =
    liveSnapshot?.draftId === draftId && liveSnapshot.provider === provider
      ? liveSnapshot
      : snapshotQuery.data ?? null;

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

  return { snapshot, snapshotQuery, transportState, refresh };
}
