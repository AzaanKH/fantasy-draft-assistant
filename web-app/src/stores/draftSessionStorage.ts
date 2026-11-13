import { type LeagueSettings } from '@fantasy-draft/shared/league';
import type { DraftSessionIdentity } from '@fantasy-draft/shared/sync';
export type { DraftSessionIdentity } from '@fantasy-draft/shared/sync';
import type { DraftProgress } from '@fantasy-draft/shared/draft';
import type {
  DraftConfig,
  DraftStore,
  PreloadedKeeper,
  RecordedDraftPick,
  UnresolvedProviderPick,
} from './draft/types';

/** The localStorage surface the older format lived in; read by the importer. */
export type DraftSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** A saved draft session. The version 1 localStorage format and the IndexedDB head share this shape. */
export interface PersistedDraftSession {
  readonly version: 1;
  /** Advances by one per lineage entry a write adds, so tabs can detect that another tab saved first. */
  readonly revision: number;
  /**
   * Recent write IDs this session includes, newest last: saves it builds on and
   * overwritten saves merged back into it. A recorded save missing from the
   * lineage was overwritten by a concurrent save and must be merged back.
   */
  readonly lineage: readonly string[];
  readonly identity: DraftSessionIdentity;
  readonly config: DraftConfig;
  readonly leagueSettings: LeagueSettings;
  readonly currentPick: number;
  readonly draftProgress: DraftProgress;
  readonly draftHistory: RecordedDraftPick[];
  readonly shortlistedPlayerIds: string[];
  readonly preloadedKeepers: PreloadedKeeper[];
  readonly keepersInitialized: boolean;
  readonly unresolvedProviderPicks: UnresolvedProviderPick[];
  readonly decisionLens: DraftStore['decisionLens'];
  readonly manualContinuityBaselineAt: number | null;
  readonly lastConfirmedSyncAt: number | null;
  readonly lastConfirmedPickNumber: number;
}
