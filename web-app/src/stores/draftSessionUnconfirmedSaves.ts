import type { RecordedDraftPick } from './draft/types';
import type { PersistedDraftSession } from './draftSessionStorage';

/**
 * Session fields merged as whole values. A change applies only where the stored
 * session still holds the value the writing tab started from.
 */
type MergedField =
  | 'config'
  | 'leagueSettings'
  | 'preloadedKeepers'
  | 'keepersInitialized'
  | 'unresolvedProviderPicks'
  | 'decisionLens'
  | 'manualContinuityBaselineAt'
  | 'lastConfirmedSyncAt'
  | 'lastConfirmedPickNumber'
  | 'currentPick';

type FieldChanges = {
  readonly [Field in MergedField]?: {
    readonly before: PersistedDraftSession[Field];
    readonly after: PersistedDraftSession[Field];
  };
};

interface DraftPickChange {
  readonly pickNumber: number;
  readonly before: RecordedDraftPick | null;
  readonly after: RecordedDraftPick | null;
}

/**
 * What one save changed, stored as data so any tab can merge it back after a
 * concurrent save overwrote it, even once the writing tab has reloaded.
 */
export interface DraftSessionChange {
  readonly writeId: string;
  /** Newest write in the session this save built on; null for a first save. */
  readonly baseWriteId: string | null;
  /** Revision of the session this save wrote. */
  readonly revision: number;
  readonly picks: readonly DraftPickChange[];
  readonly queueAdded: readonly string[];
  readonly queueRemoved: readonly string[];
  readonly fields: FieldChanges;
}
