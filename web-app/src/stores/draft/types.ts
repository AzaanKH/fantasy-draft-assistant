import type { Probability } from '@fantasy-draft/shared/units';
import type {
  Position,
} from '@fantasy-draft/shared/league';
import type {
  DraftProgress,
  DecisionLens,
  DraftPick,
} from '@fantasy-draft/shared/draft';
import type {
  DraftType,
} from '@fantasy-draft/shared/sync';
import type {
  LeagueSettings,
  RosterRequirements,
} from '@fantasy-draft/shared/league';
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
  /** How quickly CPU teams pick while the mock auto-advances to the user's slot. */
  cpuPickPace: MockCpuPickPace;
}

export type MockCpuPickPace = 'watch' | 'fast' | 'instant';

/** Tab-local controls for CPU auto-advance; never saved with the draft session. */
interface MockAutoAdvanceState {
  /** Set by Pause, undo, and branching; cleared by Resume, a manual pick, or a new mock. */
  paused: boolean;
  /** Holds CPU picks while the mock settings dialog is open. */
  settingsOpen: boolean;
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
  readonly refused?: true;
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
  connectionPreferences?: { slotConfirmed: boolean; usePrimaryLeagueSettings?: boolean; settingsProfile?: 'quick-mock' };
  /** Retained through restart until a newer successful provider history is applied. */
  manualContinuityBaselineAt: number | null;
  lastConfirmedSyncAt: number | null;
  lastConfirmedPickNumber: number;

  config: DraftConfig;
  leagueSettings: LeagueSettings;
  mockSettings: MockDraftSettings;
  mockAutoAdvance: MockAutoAdvanceState;

  draftProgress: DraftProgress;
  draftHistory: RecordedDraftPick[];
  shortlistedPlayerIds: string[];
  preloadedKeepers: PreloadedKeeper[];
  keepersInitialized: boolean;
  mockSurvivalProbabilities: Record<string, Probability>;
  /** Provider picks excluded from canonical state until their player identity resolves. */
  unresolvedProviderPicks: UnresolvedProviderPick[];

  decisionLens: DecisionLens;
  filter: FilterState;
}

export interface DraftActions {
  setSessionMode: (mode: DraftSessionMode) => void;
  setLiveDraftSession: (identity: DraftSessionIdentity | null) => void;
  enterManualContinuity: (baselineAt: number) => void;

  setConfig: (config: Partial<DraftConfig>) => void;
  applyLeagueSettings: (settings: LeagueSettings) => void;
  setRosterRequirements: (requirements: RosterRequirements) => void;
  setMockSettings: (settings: Partial<MockDraftSettings>) => void;
  setMockAutoAdvancePaused: (paused: boolean) => void;
  setMockSettingsOpen: (open: boolean) => void;

  markPlayerDrafted: (
    playerId: string,
    playerName: string,
    position: Position,
    teamIndex: number,
    teamName: string,
    pickNumber?: number,
    source?: RecordedDraftPick['source'],
    expected?: { readonly pickNumber: number; readonly actor: 'user' | 'cpu' }
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
  consumeKeeperAtCurrentPick: (expectedPickNumber?: number) => void;
  undoLastPick: () => void;
  branchFromPick: (pickNumber: number) => void;
  resetDraft: () => void;
  setMockSurvivalProbabilities: (probabilities: Readonly<Record<string, Probability>>) => void;
  togglePlayerShortlisted: (playerId: string) => void;
  removePlayerFromShortlist: (playerId: string) => void;
  /** Moves a queued player by one or more places; out-of-range moves are ignored. */
  moveShortlistedPlayer: (playerId: string, offset: number) => void;

  setDecisionLens: (lens: DecisionLens) => void;
  setPositionFilter: (position: Position | 'ALL') => void;
  setSearchQuery: (query: string) => void;
}

export type DraftStore = DraftState & DraftActions;


export type SetDraftState = (transition: (state: Draft<DraftState>) => void) => boolean;
