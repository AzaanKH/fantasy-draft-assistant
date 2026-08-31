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
  fetchImplementation: typeof fetch = fetch
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

  return {
    async fetch(status) {
      const url = buildSyncSnapshotUrl(await getServerUrl(), status);
      if (!url) {
        return null;
      }

      const response = await fetchImplementation(url);
      return readSnapshot(response);
    },

    async publishEspnSnapshot(snapshot) {
      const serverUrl = (await getServerUrl()).replace(/\/$/, '');
      const url = `${serverUrl}/api/sync/espn/drafts/${encodeURIComponent(snapshot.draft.draftId)}/snapshot`;
      const response = await fetchImplementation(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      return readSnapshot(response);
    },
  };
}
