import { isDraftProvider, isDraftSyncConnection, isValidDraftSyncId, type DraftProvider } from '@fantasy-draft/shared/sync';
import { IS_DEMO } from '@/lib/demo-mode';


export const DRAFT_SYNC_STORAGE_KEY = 'fantasy-draft-live-sync-v1';

export interface PersistedDraftSyncConnection {
  readonly provider: DraftProvider;
  readonly draftId: string;
  readonly draftPosition: number | null;
  readonly usePrimaryLeagueSettings?: boolean;
  readonly settingsProfile?: 'quick-mock';
}

export function isDraftPosition(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20;
}

export function parseStoredDraftSyncConnection(
  serialized: string | null
): PersistedDraftSyncConnection | null {
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    return isDraftSyncConnection(value) ? value : null;
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

export function readStoredConnection(): PersistedDraftSyncConnection | null {
  if (typeof window === 'undefined' || IS_DEMO) return null;

  try {
    return parseStoredDraftSyncConnection(
      window.localStorage.getItem(DRAFT_SYNC_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function persistConnection(connection: PersistedDraftSyncConnection | null): void {
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

export function resolveInitialConnection(search: string, stored: PersistedDraftSyncConnection | null): PersistedDraftSyncConnection | null {
  if (IS_DEMO) return stored;
  const url = getDraftSyncConnectionFromSearch(search);
  if (!url) return stored;
  const sameDraft = stored?.provider === url.provider && stored.draftId === url.draftId;
  const explicitSettings = new URLSearchParams(search).has('settings');
  return {
    ...url,
    draftPosition: stored && !sameDraft ? null : url.draftPosition ?? (sameDraft ? stored.draftPosition : null),
    ...(!explicitSettings && sameDraft && stored.usePrimaryLeagueSettings ? { usePrimaryLeagueSettings: true } : {}),
    ...(!explicitSettings && sameDraft && stored.settingsProfile === 'quick-mock' ? { settingsProfile: 'quick-mock' as const } : {}),
  };
}
