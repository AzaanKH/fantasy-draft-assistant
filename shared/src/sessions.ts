import { isDraftProvider, type DraftProvider } from './sync.js';
import { isPlainObject } from './objects.js';

export const DRAFT_SESSION_LINEAGE_LIMIT = 100;

export interface DraftSessionIdentity {
  readonly provider: DraftProvider;
  readonly draftId: string;
}

interface DraftSyncConnection extends DraftSessionIdentity {
  readonly draftPosition: number | null;
  readonly usePrimaryLeagueSettings?: boolean;
  readonly settingsProfile?: 'quick-mock';
}

export function isValidDraftSyncId(provider: DraftProvider, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  switch (provider) {
    case 'sleeper': return /^[A-Za-z0-9_-]{1,128}$/.test(value);
    case 'espn':
    case 'yahoo': return /^\d{1,20}$/.test(value);
  }
}

export function isDraftSessionIdentity(value: unknown): value is DraftSessionIdentity {
  return isPlainObject(value) && isDraftProvider(value.provider) && isValidDraftSyncId(value.provider, value.draftId);
}

export function isDraftSyncConnection(value: unknown): value is DraftSyncConnection {
  return isDraftSessionIdentity(value) && isPlainObject(value) &&
    (value.draftPosition === null || typeof value.draftPosition === 'number' && Number.isInteger(value.draftPosition) && value.draftPosition >= 1 && value.draftPosition <= 20) &&
    (value.usePrimaryLeagueSettings === undefined || typeof value.usePrimaryLeagueSettings === 'boolean') &&
    (value.settingsProfile === undefined || value.settingsProfile === 'quick-mock') &&
    (value.settingsProfile === undefined || value.provider === 'sleeper' && value.usePrimaryLeagueSettings !== true) &&
    (value.provider === 'sleeper' || value.usePrimaryLeagueSettings !== true);
}

/** Retained local sessions, without requesting new provider data. */
export type { DraftSessionSummary } from './catalog/sync-decoders.js';
