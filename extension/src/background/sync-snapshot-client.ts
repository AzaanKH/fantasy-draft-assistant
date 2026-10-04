import { Data, Effect } from 'effect';
import {
  isDraftSyncSnapshot,
  type DraftSyncSnapshot,
  type EspnDraftSnapshot,
} from '@fantasy-draft/shared';
import type { DraftRoomStatus } from '../shared/types';
import { localSyncBase } from '../shared/local-urls';

/** Pairing, the local server, or its response failed; the message explains which. */
export class SyncRequestError extends Data.TaggedError('SyncRequestError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SyncSnapshotClient {
  fetch(status: DraftRoomStatus): Effect.Effect<DraftSyncSnapshot | null, SyncRequestError>;
  publishEspnSnapshot(snapshot: EspnDraftSnapshot): Effect.Effect<DraftSyncSnapshot, SyncRequestError>;
}

const DEFAULT_SYNC_REQUEST_TIMEOUT_MS = 10_000;

const syncError = (cause: unknown) => cause instanceof SyncRequestError ? cause : new SyncRequestError({
  message: cause instanceof Error ? cause.message : String(cause),
  cause,
});

/** Settings reads and URL validation can reject or throw; both become a SyncRequestError. */
const attempt = <A>(run: () => A | Promise<A>) => Effect.tryPromise({ try: async () => run(), catch: syncError });

export function buildSyncSnapshotUrl(
  serverUrl: string,
  status: DraftRoomStatus
): string | null {
  if (!status.draftId) {
    return null;
  }

  const provider = status.provider ?? 'sleeper';
  return `${localSyncBase(serverUrl)}/api/sync/${provider}/drafts/${encodeURIComponent(status.draftId)}`;
}

export function createSyncSnapshotClient(
  getServerUrl: () => Promise<string>,
  getToken: () => Promise<string>,
  fetchImplementation: typeof fetch = fetch,
  requestTimeoutMs: number = DEFAULT_SYNC_REQUEST_TIMEOUT_MS
): SyncSnapshotClient {
  const requestSnapshot = (url: string, init: RequestInit) => Effect.tryPromise({
    try: async (signal) => {
      const response = await fetchImplementation(url, { ...init, signal });
      if (!response.ok) {
        throw new Error(`Snapshot request failed: ${String(response.status)}`);
      }
      const parsed: unknown = await response.json();
      if (!isDraftSyncSnapshot(parsed)) {
        throw new Error('Sync server returned an invalid draft snapshot');
      }
      return parsed;
    },
    catch: syncError,
  }).pipe(Effect.timeoutOrElse({
    duration: requestTimeoutMs,
    orElse: () => Effect.fail(new SyncRequestError({ message: 'Snapshot request timed out' })),
  }));

  return {
    fetch: (status) => Effect.gen(function* () {
      const url = yield* attempt(async () => buildSyncSnapshotUrl(await getServerUrl(), status));
      if (!url) {
        return null;
      }
      const token = yield* attempt(getToken);
      return yield* requestSnapshot(url, { headers: { 'X-Sync-Token': token }, redirect: 'error' });
    }),

    publishEspnSnapshot: (snapshot) => Effect.gen(function* () {
      const serverUrl = yield* attempt(async () => localSyncBase(await getServerUrl()));
      const url = `${serverUrl}/api/sync/espn/drafts/${encodeURIComponent(snapshot.draft.draftId)}/snapshot`;
      const token = yield* attempt(getToken);
      return yield* requestSnapshot(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Token': token },
        redirect: 'error',
        body: JSON.stringify(snapshot),
      });
    }),
  };
}
