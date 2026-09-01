import { create } from 'zustand';
import type { DraftProvider } from '@fantasy-draft/shared';

export const DRAFT_SYNC_STORAGE_KEY = 'fantasy-draft-live-sync-v1';

export interface PersistedDraftSyncConnection {
  readonly provider: DraftProvider;
  readonly draftId: string;
  readonly draftPosition: number | null;
}

interface DraftSyncConnectionStore {
  readonly connection: PersistedDraftSyncConnection | null;
  startConnection: (provider: DraftProvider, draftId: string) => void;
  confirmDraftPosition: (draftPosition: number) => void;
  restoreConnection: (connection: PersistedDraftSyncConnection) => void;
  disconnect: () => void;
}

function isDraftProvider(value: unknown): value is DraftProvider {
  return value === 'sleeper' || value === 'yahoo' || value === 'espn';
}

function isDraftPosition(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20;
}

export function isPersistedDraftSyncConnection(
  value: unknown
): value is PersistedDraftSyncConnection {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return (
    isDraftProvider(candidate.provider) &&
    typeof candidate.draftId === 'string' &&
    candidate.draftId.length > 0 &&
    (candidate.draftPosition === null || isDraftPosition(candidate.draftPosition))
  );
}

export function parseStoredDraftSyncConnection(
  serialized: string | null
): PersistedDraftSyncConnection | null {
  if (!serialized) return null;

  try {
    const parsed: unknown = JSON.parse(serialized);
    return isPersistedDraftSyncConnection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getDraftSyncConnectionFromSearch(
  search: string
): PersistedDraftSyncConnection | null {
  const params = new URLSearchParams(search);
  const provider = params.get('provider');
  const draftId = params.get('draftId') ?? params.get('leagueId');
  if (!isDraftProvider(provider) || !draftId) return null;

  const parsedPosition = Number.parseInt(params.get('position') ?? '', 10);
  return {
    provider,
    draftId,
    draftPosition: isDraftPosition(parsedPosition) ? parsedPosition : null,
  };
}

export function getDraftSyncSearch(
  search: string,
  connection: PersistedDraftSyncConnection | null
): string {
  const params = new URLSearchParams(search);
  params.delete('provider');
  params.delete('draftId');
  params.delete('leagueId');
  params.delete('position');

  if (connection) {
    params.set('provider', connection.provider);
    params.set('draftId', connection.draftId);
    if (connection.draftPosition !== null) {
      params.set('position', String(connection.draftPosition));
    }
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function readStoredConnection(): PersistedDraftSyncConnection | null {
  if (typeof window === 'undefined') return null;

  try {
    return parseStoredDraftSyncConnection(
      window.localStorage.getItem(DRAFT_SYNC_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

function persistConnection(connection: PersistedDraftSyncConnection | null): void {
  if (typeof window === 'undefined') return;

  try {
    if (connection) {
      window.localStorage.setItem(
        DRAFT_SYNC_STORAGE_KEY,
        JSON.stringify(connection)
      );
    } else {
      window.localStorage.removeItem(DRAFT_SYNC_STORAGE_KEY);
    }
  } catch {
    // A blocked or full storage area must not stop the live draft connection.
  }
}

export const useDraftSyncConnectionStore = create<DraftSyncConnectionStore>(
  (set, get) => ({
    connection: readStoredConnection(),
    startConnection: (provider, draftId) => {
      const normalizedDraftId = draftId.trim();
      if (!normalizedDraftId) return;

      const connection: PersistedDraftSyncConnection = {
        provider,
        draftId: normalizedDraftId,
        draftPosition: null,
      };
      persistConnection(connection);
      set({ connection });
    },
    confirmDraftPosition: (draftPosition) => {
      const current = get().connection;
      if (!current || !isDraftPosition(draftPosition)) return;

      const connection = { ...current, draftPosition };
      persistConnection(connection);
      set({ connection });
    },
    restoreConnection: (connection) => {
      if (!isPersistedDraftSyncConnection(connection)) return;
      persistConnection(connection);
      set({ connection });
    },
    disconnect: () => {
      persistConnection(null);
      set({ connection: null });
    },
  })
);

export function initializeDraftSyncConnection(search: string): void {
  const urlConnection = getDraftSyncConnectionFromSearch(search);
  if (!urlConnection) return;

  const store = useDraftSyncConnectionStore.getState();
  const storedConnection = store.connection;
  const connection =
    urlConnection.draftPosition === null &&
    storedConnection?.provider === urlConnection.provider &&
    storedConnection.draftId === urlConnection.draftId
      ? {
          ...urlConnection,
          draftPosition: storedConnection.draftPosition,
        }
      : urlConnection;
  store.restoreConnection(connection);
}
