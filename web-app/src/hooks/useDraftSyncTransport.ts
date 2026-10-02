import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isDraftSyncSnapshot,
  isDraftSyncUpdate,
  type DraftProvider,
  type DraftSyncSnapshot,
  type DraftSyncUpdate,
} from '@fantasy-draft/shared';
import type { DraftSyncTransportState } from '@/lib/draft-sync-state';

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

export function useDraftSyncTransport(provider: DraftProvider, draftId: string | null) {
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
