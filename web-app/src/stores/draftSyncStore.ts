import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { isDraftProvider, type DraftProvider } from '@fantasy-draft/shared/sync';
import { IS_DEMO } from '@/lib/demo-mode';

import { decodeDraftSyncConnection, isDraftSyncConnection, isValidDraftSyncId } from '@fantasy-draft/shared/catalog';

export const DRAFT_SYNC_STORAGE_KEY = 'fantasy-draft-live-sync-v1';

export interface PersistedDraftSyncConnection {
  readonly provider: DraftProvider;
  readonly draftId: string;
  readonly draftPosition: number | null;
  readonly usePrimaryLeagueSettings?: boolean;
  readonly settingsProfile?: 'quick-mock';
}

export interface DraftSyncConnectionStore {
  readonly connection: PersistedDraftSyncConnection | null;
  startConnection: (provider: DraftProvider, draftId: string) => void;
  confirmDraftPosition: (draftPosition: number) => void;
  restoreConnection: (connection: PersistedDraftSyncConnection) => void;
  setPrimaryLeagueSettings: (enabled: boolean) => void;
  setQuickMockSettings: (enabled: boolean) => void;
  disconnect: () => void;
}

function isDraftPosition(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20;
}

export function parseStoredDraftSyncConnection(
  serialized: string | null
): PersistedDraftSyncConnection | null {
  if (!serialized) return null;

  try {
    return decodeDraftSyncConnection(JSON.parse(serialized));
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
  if (!isDraftProvider(provider) || !isValidDraftSyncId(provider, draftId)) return null;

  const parsedPosition = Number.parseInt(params.get('position') ?? '', 10);
  return {
    provider,
    draftId,
    ...(provider === 'sleeper' && params.get('settings') === 'primary-league-mock'
      ? { usePrimaryLeagueSettings: true } : {}),
    ...(provider === 'sleeper' && params.get('settings') === 'quick-mock' ? { settingsProfile: 'quick-mock' as const } : {}),
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
  params.delete('settings');

  if (connection) {
    params.set('provider', connection.provider);
    params.set('draftId', connection.draftId);
    if (connection.provider === 'sleeper' && connection.usePrimaryLeagueSettings) {
      params.set('settings', 'primary-league-mock');
    }
    if (connection.settingsProfile === 'quick-mock') params.set('settings', 'quick-mock');
    if (connection.draftPosition !== null) {
      params.set('position', String(connection.draftPosition));
    }
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function readStoredConnection(): PersistedDraftSyncConnection | null {
  if (typeof window === 'undefined' || IS_DEMO) return null;

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

export type DraftSyncConnectionStoreHook = UseBoundStore<StoreApi<DraftSyncConnectionStore>>;

interface DraftSyncConnectionStoreOptions {
  readonly initialConnection: PersistedDraftSyncConnection | null;
  readonly persist: (connection: PersistedDraftSyncConnection | null) => void;
}

export function createDraftSyncConnectionStore({
  initialConnection,
  persist,
}: DraftSyncConnectionStoreOptions): DraftSyncConnectionStoreHook {
  return create<DraftSyncConnectionStore>((set, get) => ({
    connection: initialConnection,
    startConnection: (provider, draftId) => {
      const normalizedDraftId = draftId.trim();
      if (!isDraftProvider(provider) || !isValidDraftSyncId(provider, normalizedDraftId)) return;

      const current = get().connection;
      const connection: PersistedDraftSyncConnection = {
        provider,
        draftId: normalizedDraftId,
        ...(current?.provider === provider && current.draftId === normalizedDraftId && current.usePrimaryLeagueSettings
          ? { usePrimaryLeagueSettings: true } : {}),
        ...(current?.provider === provider && current.draftId === normalizedDraftId && current.settingsProfile === 'quick-mock'
          ? { settingsProfile: 'quick-mock' as const } : {}),
        draftPosition:
          current?.provider === provider && current.draftId === normalizedDraftId
            ? current.draftPosition
            : null,
      };
      persist(connection);
      set({ connection });
    },
    confirmDraftPosition: (draftPosition) => {
      const current = get().connection;
      if (!current || !isDraftPosition(draftPosition)) return;

      const connection = { ...current, draftPosition };
      persist(connection);
      set({ connection });
    },
    restoreConnection: (connection) => {
      if (!isDraftSyncConnection(connection)) return;
      persist(connection);
      set({ connection });
    },
    setPrimaryLeagueSettings: (enabled) => {
      const current = get().connection;
      if (!current || current.provider !== 'sleeper') return;
      const connection = { ...current };
      if (enabled) {
        connection.usePrimaryLeagueSettings = true;
        delete connection.settingsProfile;
      }
      else delete connection.usePrimaryLeagueSettings;
      persist(connection);
      set({ connection });
    },
    setQuickMockSettings: (enabled) => {
      const current = get().connection;
      if (!current || current.provider !== 'sleeper') return;
      const connection = { ...current };
      if (enabled) { connection.settingsProfile = 'quick-mock'; delete connection.usePrimaryLeagueSettings; }
      else delete connection.settingsProfile;
      persist(connection);
      set({ connection });
    },
    disconnect: () => {
      persist(null);
      set({ connection: null });
    },
  }));
}

export const useDraftSyncConnectionStore = createDraftSyncConnectionStore({
  initialConnection: readStoredConnection(),
  persist: persistConnection,
});

export function initializeDraftSyncConnection(search: string): void {
  // The static demo has no sync server to connect to.
  if (IS_DEMO) return;
  const urlConnection = getDraftSyncConnectionFromSearch(search);
  if (!urlConnection) return;

  const store = useDraftSyncConnectionStore.getState();
  const storedConnection = store.connection;
  const sameDraft = storedConnection?.provider === urlConnection.provider &&
    storedConnection.draftId === urlConnection.draftId;
  const explicitSettings = new URLSearchParams(search).has('settings');
  const connection: PersistedDraftSyncConnection = sameDraft ? {
    ...urlConnection,
    draftPosition: urlConnection.draftPosition ?? storedConnection.draftPosition,
    ...(!explicitSettings && storedConnection.settingsProfile === 'quick-mock' ? { settingsProfile: 'quick-mock' as const } : {}),
    ...(!explicitSettings && storedConnection.usePrimaryLeagueSettings ? { usePrimaryLeagueSettings: true } : {}),
  } : urlConnection;
  store.restoreConnection(connection);
}
