import { isDraftProvider, isValidDraftSyncId, isDraftSyncConnection, type DraftProvider } from '@fantasy-draft/shared/sync';
import type { StoreApi } from 'zustand';
import type { LeagueSettings } from '@fantasy-draft/shared/league';
import type { DraftSessionIdentity } from '@/stores/draftSessionStorage';
import type { DraftState } from '@/stores/draft/types';
import type { PersistedDraftSyncConnection } from './connection-hints';

export interface ProviderSettingsHint extends DraftSessionIdentity {
  readonly config: Pick<DraftState['config'], 'totalTeams' | 'totalRounds' | 'draftType'>;
  readonly leagueSettings: LeagueSettings;
}

export interface ConnectionActions {
  applyProviderSettings(hint: ProviderSettingsHint): void;
  startConnection(provider: DraftProvider, draftId: string): void;
  confirmDraftPosition(position: number): void;
  restoreConnection(hint: PersistedDraftSyncConnection): void;
  applyHint(hint: PersistedDraftSyncConnection): void;
  setPrimaryLeagueSettings(enabled: boolean): void;
  setQuickMockSettings(enabled: boolean): void;
  disconnect(): void;
}
export type ConnectionCommand = { [K in keyof ConnectionActions]: [type: `connection.${K}`, ...args: Parameters<ConnectionActions[K]>] }[keyof ConnectionActions];
export type ConnectionQuery = { readonly connection: PersistedDraftSyncConnection | null };

export function getConnection(state: DraftState): PersistedDraftSyncConnection | null {
  if (!state.liveSession) return null;
  const preferences = state.connectionPreferences;
  return { ...state.liveSession,
    ...(preferences?.usePrimaryLeagueSettings ? { usePrimaryLeagueSettings: true } : {}),
    ...(preferences?.settingsProfile ? { settingsProfile: preferences.settingsProfile } : {}),
    draftPosition: state.sessionMode === 'live' || preferences?.slotConfirmed ? state.config.myPickPosition : null };
}

export function connectionReader(draft: Pick<StoreApi<DraftState>, 'getState' | 'getInitialState' | 'subscribe'>, select: (state: DraftState) => DraftState = state => state): Pick<StoreApi<ConnectionQuery>, 'getState' | 'getInitialState' | 'subscribe'> {
  let cached: ConnectionQuery = { connection: null };
  function read(state: DraftState): ConnectionQuery {
    const connection = getConnection(select(state));
    if (JSON.stringify(connection) !== JSON.stringify(cached.connection)) cached = { connection };
    return cached;
  }
  return { getState: () => read(draft.getState()), getInitialState: () => read(draft.getInitialState()),
    subscribe: listener => draft.subscribe((state, previous) => {
      const before = read(previous); const next = read(state);
      if (next !== before) listener(next, before);
    }) };
}

export function connectionHint(command: ConnectionCommand, current: PersistedDraftSyncConnection | null): PersistedDraftSyncConnection | null | undefined {
  switch (command[0]) {
    case 'connection.disconnect': return null;
    case 'connection.startConnection': {
      const [, provider, raw] = command; const draftId = raw.trim();
      if (!isDraftProvider(provider) || !isValidDraftSyncId(provider, draftId)) return undefined;
      return current?.provider === provider && current.draftId === draftId ? current : { provider, draftId, draftPosition: null };
    }
    case 'connection.applyHint':
    case 'connection.restoreConnection': return isDraftSyncConnection(command[1]) ? command[1] : undefined;
    default: return undefined;
  }
}

export function connectionPreferences(hint: PersistedDraftSyncConnection, confirmed: boolean): NonNullable<DraftState['connectionPreferences']> {
  return { slotConfirmed: confirmed, ...(hint.usePrimaryLeagueSettings ? { usePrimaryLeagueSettings: true } : {}),
    ...(hint.settingsProfile ? { settingsProfile: hint.settingsProfile } : {}) };
}
