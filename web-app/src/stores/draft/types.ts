import type {
  DecisionLens,
  Player,
  Position,
  DraftPick,
  DraftType,
  LeagueSettings,
  RosterRequirements,
} from '@fantasy-draft/shared';
import type { Draft } from 'immer';
import type { DraftSessionIdentity } from '../draftSessionStorage';

export interface MutableRoster {
  QB: string[];
  RB: string[];
  WR: string[];
  TE: string[];
  K: string[];
  DEF: string[];
}

export type DraftTeamRoster = MutableRoster;

export interface FilterState {
  position: Position | 'ALL';
  searchQuery: string;
}

/**
 * Draft configuration
 */
export interface DraftConfig {
  totalTeams: number;
  totalRounds: number;
  draftType: DraftType;
  myPickPosition: number;
  rosterRequirements: RosterRequirements;
}

export interface MockDraftSettings {
  /** 0 is market-chalk; 1 samples more aggressively from the plausible top 15. */
  randomness: number;
  seed: number;
  survivalIterations: number;
}

export type DraftSessionMode = 'setup' | 'mock' | 'live';

export interface RecordedDraftPick extends DraftPick {
  readonly shortlistIndex?: number;
  readonly source: 'manual' | 'cpu' | 'keeper' | 'sync' | 'provisional';
  /** Number of local corrections made before Provider Truth returns. */
  readonly provisionalRevision?: number;
  /** Time of the latest local correction. The original timestamp remains intact. */
  readonly provisionalUpdatedAt?: number;
}

export interface ProvisionalPickInput {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly teamName: string;
}

export interface SyncedImportedPick {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly teamName: string;
  readonly isMyPick: boolean;
}

export interface ReconciledDraftPick {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly teamName: string;
}

export type ProvisionalPickConfirmation = ReconciledDraftPick;

export interface DraftPickCorrection {
  readonly pickNumber: number;
  readonly previous: ReconciledDraftPick;
  readonly provider: ReconciledDraftPick;
}

export interface DraftPickRemoval extends ReconciledDraftPick {
  readonly source: Extract<RecordedDraftPick['source'], 'manual' | 'provisional' | 'sync'>;
}

export interface UnresolvedProviderPick {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly nflTeam: string | null;
}

export interface DraftReconciliationResult {
  /** Whether applying the provider snapshot changed canonical draft state. */
  readonly changed: boolean;
  /** Provisional Picks that matched Provider Truth at the same draft position. */
  readonly confirmations: readonly ProvisionalPickConfirmation[];
  /** Local or previously confirmed picks replaced by Provider Truth. */
  readonly corrections: readonly DraftPickCorrection[];
  /** Local or previously confirmed picks absent from Provider Truth. */
  readonly removals: readonly DraftPickRemoval[];
  /** Provider identities that changed and still cannot map to canonical player data. */
  readonly unresolvedIdentities: readonly UnresolvedProviderPick[];
}

export interface PreloadedKeeper {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly round: number;
  readonly isMyKeeper: boolean;
}

export interface DraftState {
  // Explicitly separates a disconnected preview from mock and live drafting.
  sessionMode: DraftSessionMode;
  liveSession: DraftSessionIdentity | null;
  /** Retained through restart until a newer successful provider history is applied. */
  manualContinuityBaselineAt: number | null;
  lastConfirmedSyncAt: number | null;
  lastConfirmedPickNumber: number;

  // Draft configuration
  config: DraftConfig;
  leagueSettings: LeagueSettings;
  mockSettings: MockDraftSettings;

  // Draft progress
  currentPick: number;
  /** All unavailable players: completed picks plus keepers reserved for future round selections. */
  draftedPlayerIds: Set<string>;
  draftHistory: RecordedDraftPick[];
  shortlistedPlayerIds: string[];
  preloadedKeepers: PreloadedKeeper[];
  keepersInitialized: boolean;
  mockSurvivalProbabilities: Record<string, number>;
  /** Provider picks excluded from canonical state until their player identity resolves. */
  unresolvedProviderPicks: UnresolvedProviderPick[];

  // My team
  myRoster: MutableRoster;
  /** Canonical roster for every draft slot, including keepers and provisional picks. */
  teamRosters: MutableRoster[];

  // UI state
  decisionLens: DecisionLens;
  filter: FilterState;

  // Computed
  isMyTurn: boolean;
  totalPicks: number;
}

/**
 * Draft store actions
 */
export interface DraftActions {
  setSessionMode: (mode: DraftSessionMode) => void;
  setLiveDraftSession: (identity: DraftSessionIdentity | null) => void;
  enterManualContinuity: (baselineAt: number) => void;

  // Configuration
  setConfig: (config: Partial<DraftConfig>) => void;
  applyLeagueSettings: (settings: LeagueSettings) => void;
  setRosterRequirements: (requirements: RosterRequirements) => void;
  setMockSettings: (settings: Partial<MockDraftSettings>) => void;

  // Draft actions
  markPlayerDrafted: (
    playerId: string,
    playerName: string,
    position: Position,
    teamIndex: number,
    teamName: string,
    pickNumber?: number,
    source?: RecordedDraftPick['source']
  ) => void;
  recordProvisionalPick: (pick: ProvisionalPickInput) => boolean;
  correctProvisionalPick: (
    originalPickNumber: number,
    replacement: ProvisionalPickInput
  ) => boolean;
  removeProvisionalPick: (pickNumber: number) => boolean;
  reconcileSyncedPicks: (
    picks: readonly SyncedImportedPick[],
    nextPickNumber: number,
    unresolvedPicks?: readonly UnresolvedProviderPick[],
    confirmedAt?: number
  ) => DraftReconciliationResult;
  preloadKeepers: (
    keepers: readonly PreloadedKeeper[],
    supplyComplete?: boolean
  ) => void;
  consumeKeeperAtCurrentPick: () => void;
  undoLastPick: () => void;
  branchFromPick: (pickNumber: number) => void;
  addToMyRoster: (player: Player) => void;
  resetDraft: () => void;
  setMockSurvivalProbabilities: (probabilities: Readonly<Record<string, number>>) => void;
  togglePlayerShortlisted: (playerId: string) => void;
  removePlayerFromShortlist: (playerId: string) => void;
  /** Moves a queued player by one or more places; out-of-range moves are ignored. */
  moveShortlistedPlayer: (playerId: string, offset: number) => void;

  // UI actions
  setDecisionLens: (lens: DecisionLens) => void;
  setPositionFilter: (position: Position | 'ALL') => void;
  setSearchQuery: (query: string) => void;
}

export type DraftStore = DraftState & DraftActions;


export type SetDraftState = (transition: (state: Draft<DraftStore>) => void) => void;
