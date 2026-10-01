import { isBoundedInteger, MAX_DRAFT_PICKS, MAX_DRAFT_ROUNDS, MAX_DRAFT_TEAMS } from './limits';
import { isDraftProvider, type DraftProvider, type DraftStatus, type DraftType, type DraftSyncState } from './sync';

/** Retained local sessions, without requesting new provider data. */
export interface DraftSessionSummary {
  readonly session: string;
  readonly provider: DraftProvider;
  readonly draftId: string;
  readonly draftStatus: DraftStatus | null;
  readonly draftType: DraftType | null;
  readonly totalTeams: number | null;
  readonly totalRounds: number | null;
  readonly currentPick: number | null;
  readonly picksRecorded: number;
  readonly sync: {
    readonly state: DraftSyncState;
    readonly lastSuccessfulSyncAt: number | null;
    readonly lastError: string | null;
  };
  readonly lastActivityAt: number;
  readonly subscribers: number;
}

export function isDraftSessionSummary(value: unknown): value is DraftSessionSummary {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  const sync = row.sync as Record<string, unknown> | null;
  return isDraftProvider(row.provider) && typeof row.draftId === 'string' && row.draftId.length <= 128 &&
    row.session === `${row.provider}:${row.draftId}` &&
    (row.draftStatus === null || ['pre_draft', 'drafting', 'paused', 'complete'].includes(String(row.draftStatus))) &&
    (row.draftType === null || ['snake', 'linear', 'auction'].includes(String(row.draftType))) &&
    (row.totalTeams === null || isBoundedInteger(row.totalTeams, 2, MAX_DRAFT_TEAMS)) &&
    (row.totalRounds === null || isBoundedInteger(row.totalRounds, 1, MAX_DRAFT_ROUNDS)) &&
    (row.currentPick === null || isBoundedInteger(row.currentPick, 1, MAX_DRAFT_PICKS + 1)) &&
    isBoundedInteger(row.picksRecorded, 0, MAX_DRAFT_PICKS) &&
    typeof sync === 'object' && sync !== null &&
    ['idle', 'syncing', 'synced', 'error'].includes(String(sync.state)) &&
    (sync.lastSuccessfulSyncAt === null || typeof sync.lastSuccessfulSyncAt === 'number' && Number.isFinite(sync.lastSuccessfulSyncAt)) &&
    (sync.lastError === null || typeof sync.lastError === 'string') &&
    typeof row.lastActivityAt === 'number' && Number.isFinite(row.lastActivityAt) &&
    isBoundedInteger(row.subscribers, 0, 32);
}
