import {
  isDraftSyncSnapshot,
  type DraftSyncSnapshot,
  type EspnDraftSnapshot,
} from '@fantasy-draft/shared';
import type { DraftRoomStatus } from '../shared/types';

export interface SyncSnapshotClient {
  fetch(status: DraftRoomStatus): Promise<DraftSyncSnapshot | null>;
  publishEspnSnapshot(snapshot: EspnDraftSnapshot): Promise<DraftSyncSnapshot>;
}

export const DEFAULT_SYNC_REQUEST_TIMEOUT_MS = 10_000;

export function buildSyncSnapshotUrl(
  serverUrl: string,
  status: DraftRoomStatus
): string | null {
  if (!status.draftId) {
    return null;
  }

  const provider = status.provider ?? 'sleeper';
  return `${serverUrl.replace(/\/$/, '')}/api/sync/${provider}/drafts/${encodeURIComponent(status.draftId)}`;
}

export function createSyncSnapshotClient(
  getServerUrl: () => Promise<string>,
  fetchImplementation: typeof fetch = fetch,
  requestTimeoutMs: number = DEFAULT_SYNC_REQUEST_TIMEOUT_MS
): SyncSnapshotClient {
  const readSnapshot = async (response: Response): Promise<DraftSyncSnapshot> => {
    if (!response.ok) {
      throw new Error(`Snapshot request failed: ${String(response.status)}`);
    }
    const parsed: unknown = await response.json();
    if (!isDraftSyncSnapshot(parsed)) {
      throw new Error('Sync server returned an invalid draft snapshot');
    }
    return parsed;
  };

  const requestSnapshot = async (
    url: string,
    init?: RequestInit
  ): Promise<DraftSyncSnapshot> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, requestTimeoutMs);
    try {
      const response = await fetchImplementation(url, {
        ...init,
        signal: controller.signal,
      });
      return await readSnapshot(response);
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    async fetch(status) {
      const url = buildSyncSnapshotUrl(await getServerUrl(), status);
      if (!url) {
        return null;
      }

      return requestSnapshot(url);
    },

    async publishEspnSnapshot(snapshot) {
      const serverUrl = (await getServerUrl()).replace(/\/$/, '');
      const url = `${serverUrl}/api/sync/espn/drafts/${encodeURIComponent(snapshot.draft.draftId)}/snapshot`;
      return requestSnapshot(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
    },
  };
}
