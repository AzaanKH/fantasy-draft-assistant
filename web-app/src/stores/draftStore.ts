/**
 * Draft State Store (Zustand)
 *
 * Manages draft state including:
 * - Drafted players tracking
 * - User's roster
 * - Current pick and turn status
 * - Position filtering and sorting
 */

import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from 'react';
import { create, useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

// Enable Immer support for Set and Map
enableMapSet();
import type {
  DecisionLens,
  Player,
  Position,
  DraftPick,
  LeagueSettings,
  RosterRequirements,
} from '@fantasy-draft/shared';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  createDefaultLeagueSettings,
} from '@fantasy-draft/shared';
import type { SortField, SortDirection } from '@/lib/calculations';
import {
  canonicalizeKeeperSupply,
  getEffectiveKeeperAssignments,
} from '@/lib/keeper-supply';
import {
  getKeeperAtPick,
  getPickNumberForTeamRound,
  getTeamIndexForPick,
} from '@/lib/mock-draft-engine';

/**
 * Mutable roster structure for internal store use
 */
interface MutableRoster {
  QB: string[];
  RB: string[];
  WR: string[];
  TE: string[];
  K: string[];
  DEF: string[];
}

export type DraftTeamRoster = MutableRoster;

/**
 * Creates an empty mutable roster
 */
function createEmptyMutableRoster(): MutableRoster {
  return {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    K: [],
    DEF: [],
  };
}

/**
 * UI filter state
 */
interface FilterState {
  position: Position | 'ALL';
  hideNonStarters: boolean;
  searchQuery: string;
}

/**
 * UI sort state
 */
interface SortState {
  field: SortField;
  direction: SortDirection;
}

/**
 * Draft configuration
 */
export interface DraftConfig {
  totalTeams: number;
  totalRounds: number;
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

function addPlayerToRoster(
  roster: MutableRoster,
  position: Position,
  playerId: string
): void {
  if (!roster[position].includes(playerId)) {
    roster[position].push(playerId);
  }
}

function getKeeperPickNumbers(
  keepers: readonly PreloadedKeeper[],
  totalTeams: number
): Set<number> {
  return new Set(keepers.map((keeper) =>
    getPickNumberForTeamRound(keeper.teamIndex, keeper.round, totalTeams)
  ));
}

function advancePastKeeperSlots(
  pickNumber: number,
  keepers: readonly PreloadedKeeper[],
  totalTeams: number,
  totalPicks: number
): number {
  let nextPick = pickNumber;
  while (
    nextPick <= totalPicks &&
    getKeeperAtPick(keepers, nextPick, totalTeams)
  ) {
    nextPick += 1;
  }
  return nextPick;
}

/**
 * Complete draft store state
 */
interface DraftState {
  // Explicitly separates a disconnected preview from mock and live drafting.
  sessionMode: DraftSessionMode;

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
  sort: SortState;

  // Computed
  isMyTurn: boolean;
  totalPicks: number;
}

/**
 * Draft store actions
 */
interface DraftActions {
  setSessionMode: (mode: DraftSessionMode) => void;

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
    unresolvedPicks?: readonly UnresolvedProviderPick[]
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

  // UI actions
  setDecisionLens: (lens: DecisionLens) => void;
  setPositionFilter: (position: Position | 'ALL') => void;
  setHideNonStarters: (hide: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSort: (field: SortField, direction?: SortDirection) => void;
  toggleSortDirection: () => void;
}

export type DraftStore = DraftState & DraftActions;

function createEmptyTeamRosters(totalTeams: number): MutableRoster[] {
  return Array.from(
    { length: Math.max(0, totalTeams) },
    createEmptyMutableRoster
  );
}

function copyRoster(roster: MutableRoster | undefined): MutableRoster {
  if (!roster) return createEmptyMutableRoster();
  return {
    QB: [...roster.QB],
    RB: [...roster.RB],
    WR: [...roster.WR],
    TE: [...roster.TE],
    K: [...roster.K],
    DEF: [...roster.DEF],
  };
}

function rebuildCanonicalRosters(state: Pick<
  DraftState,
  'config' | 'draftHistory' | 'preloadedKeepers' | 'myRoster' | 'teamRosters'
>): void {
  const teamRosters = createEmptyTeamRosters(state.config.totalTeams);
  const effectiveKeepers = getEffectiveKeeperAssignments(
    state.preloadedKeepers,
    state.draftHistory,
    state.config.totalTeams
  );

  for (const keeper of effectiveKeepers) {
    const roster = teamRosters[keeper.teamIndex];
    if (roster) addPlayerToRoster(roster, keeper.position, keeper.playerId);
  }
  for (const pick of state.draftHistory) {
    const roster = teamRosters[pick.teamIndex];
    if (roster) addPlayerToRoster(roster, pick.position, pick.playerId);
  }

  state.teamRosters = teamRosters;
  state.myRoster = copyRoster(teamRosters[state.config.myPickPosition - 1]);
}

function getNextCanonicalOpenPick(
  history: readonly RecordedDraftPick[],
  keepers: readonly PreloadedKeeper[],
  totalTeams: number,
  totalPicks: number
): number {
  const occupied = new Set(history.map((pick) => pick.pickNumber));
  for (const keeperPick of getKeeperPickNumbers(keepers, totalTeams)) {
    occupied.add(keeperPick);
  }

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber += 1) {
    if (!occupied.has(pickNumber)) return pickNumber;
  }
  return totalPicks + 1;
}

function restoreShortlistedPlayer(
  shortlistedPlayerIds: string[],
  pick: RecordedDraftPick
): void {
  if (
    pick.shortlistIndex === undefined ||
    shortlistedPlayerIds.includes(pick.playerId)
  ) {
    return;
  }

  shortlistedPlayerIds.splice(
    Math.min(pick.shortlistIndex, shortlistedPlayerIds.length),
    0,
    pick.playerId
  );
}

function rebuildAfterProvisionalChange(state: Pick<
  DraftState,
  | 'config'
  | 'currentPick'
  | 'draftedPlayerIds'
  | 'draftHistory'
  | 'shortlistedPlayerIds'
  | 'preloadedKeepers'
  | 'myRoster'
  | 'teamRosters'
  | 'mockSurvivalProbabilities'
>): void {
  state.draftHistory.sort((left, right) => left.pickNumber - right.pickNumber);
  const effectiveKeepers = getEffectiveKeeperAssignments(
    state.preloadedKeepers,
    state.draftHistory,
    state.config.totalTeams
  );
  state.draftedPlayerIds = new Set([
    ...state.draftHistory.map((pick) => pick.playerId),
    ...effectiveKeepers.map((keeper) => keeper.playerId),
  ]);
  state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
    (playerId) => !state.draftedPlayerIds.has(playerId)
  );
  rebuildCanonicalRosters(state);
  state.currentPick = getNextCanonicalOpenPick(
    state.draftHistory,
    effectiveKeepers,
    state.config.totalTeams,
    state.config.totalTeams * state.config.totalRounds
  );
  state.mockSurvivalProbabilities = {};
}

function hasSameCanonicalPick(
  left: RecordedDraftPick,
  right: RecordedDraftPick
): boolean {
  return (
    left.pickNumber === right.pickNumber &&
    left.playerId === right.playerId &&
    left.playerName === right.playerName &&
    left.position === right.position &&
    left.teamIndex === right.teamIndex &&
    left.teamName === right.teamName &&
    left.timestamp === right.timestamp &&
    left.source === right.source &&
    left.shortlistIndex === right.shortlistIndex &&
    left.provisionalRevision === right.provisionalRevision &&
    left.provisionalUpdatedAt === right.provisionalUpdatedAt
  );
}

function hasSameCanonicalHistory(
  left: readonly RecordedDraftPick[],
  right: readonly RecordedDraftPick[]
): boolean {
  return (
    left.length === right.length &&
    left.every((pick, index) => {
      const other = right[index];
      return other !== undefined && hasSameCanonicalPick(pick, other);
    })
  );
}

function toReconciledDraftPick(
  pick: ReconciledDraftPick
): ReconciledDraftPick {
  return {
    pickNumber: pick.pickNumber,
    playerId: pick.playerId,
    playerName: pick.playerName,
    position: pick.position,
    teamIndex: pick.teamIndex,
    teamName: pick.teamName,
  };
}

function hasSameProviderPick(
  left: ReconciledDraftPick,
  right: ReconciledDraftPick
): boolean {
  return (
    left.pickNumber === right.pickNumber &&
    left.playerId === right.playerId &&
    left.playerName === right.playerName &&
    left.position === right.position &&
    left.teamIndex === right.teamIndex &&
    left.teamName === right.teamName
  );
}

function hasSameUnresolvedProviderPicks(
  left: readonly UnresolvedProviderPick[],
  right: readonly UnresolvedProviderPick[]
): boolean {
  return (
    left.length === right.length &&
    left.every((pick, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        pick.pickNumber === other.pickNumber &&
        pick.playerId === other.playerId &&
        pick.playerName === other.playerName &&
        pick.nflTeam === other.nflTeam
      );
    })
  );
}

/**
 * Calculate if it's the user's turn based on snake draft order
 */
export function calculateIsMyTurn(
  currentPick: number,
  myPickPosition: number,
  totalTeams: number
): boolean {
  // Snake draft: odd rounds go 1-10, even rounds go 10-1
  const round = Math.ceil(currentPick / totalTeams);
  const pickInRound = ((currentPick - 1) % totalTeams) + 1;

  const isOddRound = round % 2 === 1;
  const positionThisRound = isOddRound
    ? pickInRound
    : totalTeams - pickInRound + 1;

  return positionThisRound === myPickPosition;
}

/**
 * Default filter state
 */
const defaultFilter: FilterState = {
  position: 'ALL',
  hideNonStarters: false,
  searchQuery: '',
};

/**
 * Default sort state
 */
const defaultSort: SortState = {
  field: 'ecrRank',
  direction: 'asc',
};

/**
 * Default draft configuration for the Primary League (10 teams, 14 rounds)
 */
const defaultConfig: DraftConfig = {
  totalTeams: 10,
  totalRounds: 14,
  myPickPosition: 5,
  rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
};

const defaultMockSettings: MockDraftSettings = {
  randomness: 0.55,
  seed: 20260810,
  survivalIterations: 250,
};

/**
 * Create the draft store with Zustand + immer for immutable updates
 */
export function createDraftStore() {
  return create<DraftStore>()(
  immer((set, get) => ({
    // Initial state
    sessionMode: 'setup',
    config: defaultConfig,
    leagueSettings: createDefaultLeagueSettings(),
    mockSettings: defaultMockSettings,
    currentPick: 1,
    draftedPlayerIds: new Set<string>(),
    draftHistory: [],
    shortlistedPlayerIds: [],
    preloadedKeepers: [],
    keepersInitialized: false,
    mockSurvivalProbabilities: {},
    unresolvedProviderPicks: [],
    myRoster: createEmptyMutableRoster(),
    teamRosters: createEmptyTeamRosters(defaultConfig.totalTeams),
    decisionLens: 'best-pick',
    filter: defaultFilter,
    sort: defaultSort,

    // Computed getters
    get isMyTurn() {
      const state = get();
      return calculateIsMyTurn(
        state.currentPick,
        state.config.myPickPosition,
        state.config.totalTeams
      );
    },
    get totalPicks() {
      const state = get();
      return state.config.totalTeams * state.config.totalRounds;
    },

    // Configuration actions
    setSessionMode: (mode) =>
      { set((state) => {
        state.sessionMode = mode;
      }); },
    setConfig: (newConfig) =>
      { set((state) => {
        const nextTotalTeams = Math.max(
          2,
          Math.round(newConfig.totalTeams ?? state.config.totalTeams)
        );
        const nextTotalRounds = Math.max(
          1,
          Math.round(newConfig.totalRounds ?? state.config.totalRounds)
        );
        const nextPickPosition = Math.min(
          nextTotalTeams,
          Math.max(
            1,
            Math.round(newConfig.myPickPosition ?? state.config.myPickPosition)
          )
        );
        if (
          nextTotalTeams === state.config.totalTeams &&
          nextTotalRounds === state.config.totalRounds &&
          nextPickPosition === state.config.myPickPosition &&
          newConfig.rosterRequirements === undefined
        ) {
          return;
        }
        Object.assign(state.config, newConfig);
        state.config.totalTeams = nextTotalTeams;
        state.config.totalRounds = nextTotalRounds;
        state.config.myPickPosition = nextPickPosition;
        rebuildCanonicalRosters(state);
        state.mockSurvivalProbabilities = {};
      }); },
    applyLeagueSettings: (settings) =>
      { set((state) => {
        if (
          state.leagueSettings.fingerprint === settings.fingerprint &&
          state.leagueSettings.source === settings.source &&
          state.leagueSettings.leagueId === settings.leagueId &&
          state.leagueSettings.unsupportedScoringKeys.join('\0') ===
            settings.unsupportedScoringKeys.join('\0') &&
          state.leagueSettings.unsupportedRosterSlots.join('\0') ===
            settings.unsupportedRosterSlots.join('\0')
        ) return;
        state.leagueSettings = {
          ...settings,
          scoringRules: {
            passing: { ...settings.scoringRules.passing },
            rushing: { ...settings.scoringRules.rushing },
            receiving: { ...settings.scoringRules.receiving },
            kicking: { ...settings.scoringRules.kicking },
            defense: {
              ...settings.scoringRules.defense,
              pointsAllowed: { ...settings.scoringRules.defense.pointsAllowed },
            },
            misc: { ...settings.scoringRules.misc },
          },
          rosterRequirements: {
            QB: { ...settings.rosterRequirements.QB },
            RB: { ...settings.rosterRequirements.RB },
            WR: { ...settings.rosterRequirements.WR },
            TE: { ...settings.rosterRequirements.TE },
            FLEX: {
              starters: settings.rosterRequirements.FLEX.starters,
              eligiblePositions: [
                ...settings.rosterRequirements.FLEX.eligiblePositions,
              ],
            },
            K: { ...settings.rosterRequirements.K },
            DEF: { ...settings.rosterRequirements.DEF },
            BENCH: { ...settings.rosterRequirements.BENCH },
          },
          rawScoringSettings: { ...settings.rawScoringSettings },
          unsupportedScoringKeys: [...settings.unsupportedScoringKeys],
          unsupportedRosterSlots: [...settings.unsupportedRosterSlots],
        };
        state.config.totalTeams = Math.max(2, Math.round(settings.totalTeams));
        state.config.myPickPosition = Math.min(
          state.config.totalTeams,
          state.config.myPickPosition
        );
        state.config.rosterRequirements = {
          QB: { ...settings.rosterRequirements.QB },
          RB: { ...settings.rosterRequirements.RB },
          WR: { ...settings.rosterRequirements.WR },
          TE: { ...settings.rosterRequirements.TE },
          FLEX: {
            starters: settings.rosterRequirements.FLEX.starters,
            eligiblePositions: [
              ...settings.rosterRequirements.FLEX.eligiblePositions,
            ],
          },
          K: { ...settings.rosterRequirements.K },
          DEF: { ...settings.rosterRequirements.DEF },
          BENCH: { ...settings.rosterRequirements.BENCH },
        };
        rebuildCanonicalRosters(state);
        state.mockSurvivalProbabilities = {};
      }); },
    setRosterRequirements: (requirements) =>
      { set((state) => {
        state.config.rosterRequirements.QB = { ...requirements.QB };
        state.config.rosterRequirements.RB = { ...requirements.RB };
        state.config.rosterRequirements.WR = { ...requirements.WR };
        state.config.rosterRequirements.TE = { ...requirements.TE };
        state.config.rosterRequirements.FLEX = {
          starters: requirements.FLEX.starters,
          eligiblePositions: [...requirements.FLEX.eligiblePositions],
        };
        state.config.rosterRequirements.K = { ...requirements.K };
        state.config.rosterRequirements.DEF = { ...requirements.DEF };
        state.config.rosterRequirements.BENCH = { ...requirements.BENCH };
      }); },
    setMockSettings: (settings) =>
      { set((state) => {
        Object.assign(state.mockSettings, settings);
        state.mockSettings.randomness = Math.min(
          1,
          Math.max(0, state.mockSettings.randomness)
        );
        state.mockSettings.seed = Math.max(0, Math.round(state.mockSettings.seed));
        state.mockSettings.survivalIterations = Math.min(
          1000,
          Math.max(25, Math.round(state.mockSettings.survivalIterations))
        );
      }); },

    // Draft actions
    markPlayerDrafted: (playerId, playerName, position, teamIndex, teamName, pickNumber, source = 'manual') =>
      { set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const pickNumberToUse = pickNumber ?? state.currentPick;

        if (pickNumberToUse < 1 || pickNumberToUse > totalPicks) {
          return;
        }

        if (state.draftedPlayerIds.has(playerId) && source !== 'keeper') {
          return;
        }

        if (pickNumber !== undefined) {
          const hasPick = state.draftHistory.some(
            (pick) => pick.pickNumber === pickNumberToUse
          );
          if (hasPick) return;
        }

        if (state.currentPick > totalPicks && pickNumber === undefined) {
          return;
        }

        const shortlistIndex = state.shortlistedPlayerIds.indexOf(playerId);
        state.draftedPlayerIds.add(playerId);
        if (shortlistIndex >= 0) {
          state.shortlistedPlayerIds.splice(shortlistIndex, 1);
        }
        state.draftHistory.push({
          pickNumber: pickNumberToUse,
          playerId,
          playerName,
          position,
          teamIndex,
          teamName,
          timestamp: Date.now(),
          source,
          ...(shortlistIndex >= 0 ? { shortlistIndex } : {}),
        });
        const teamRoster = state.teamRosters[teamIndex];
        if (teamRoster) addPlayerToRoster(teamRoster, position, playerId);
        if (pickNumber !== undefined) {
          state.currentPick = Math.max(state.currentPick, pickNumberToUse + 1);
        } else {
          state.currentPick += 1;
        }
        state.mockSurvivalProbabilities = {};
      }); },

    recordProvisionalPick: (pick) => {
      let recorded = false;
      set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const expectedTeamIndex = getTeamIndexForPick(
          pick.pickNumber,
          state.config.totalTeams
        );
        const reservedKeeperPickNumbers = getKeeperPickNumbers(
          state.preloadedKeepers,
          state.config.totalTeams
        );
        const invalidPick =
          state.sessionMode !== 'live' ||
          !Number.isInteger(pick.pickNumber) ||
          pick.pickNumber < 1 ||
          pick.pickNumber > totalPicks ||
          pick.teamIndex !== expectedTeamIndex ||
          state.draftedPlayerIds.has(pick.playerId) ||
          reservedKeeperPickNumbers.has(pick.pickNumber) ||
          state.draftHistory.some((draftPick) =>
            draftPick.pickNumber === pick.pickNumber ||
            draftPick.playerId === pick.playerId
          );
        if (invalidPick) return;

        const shortlistIndex = state.shortlistedPlayerIds.indexOf(pick.playerId);
        if (shortlistIndex >= 0) {
          state.shortlistedPlayerIds.splice(shortlistIndex, 1);
        }
        state.draftHistory.push({
          ...pick,
          timestamp: Date.now(),
          source: 'provisional',
          ...(shortlistIndex >= 0 ? { shortlistIndex } : {}),
        });
        rebuildAfterProvisionalChange(state);
        recorded = true;
      });
      return recorded;
    },

    correctProvisionalPick: (originalPickNumber, replacement) => {
      let corrected = false;
      set((state) => {
        const originalIndex = state.draftHistory.findIndex(
          (pick) =>
            pick.pickNumber === originalPickNumber &&
            pick.source === 'provisional'
        );
        const original = state.draftHistory[originalIndex];
        if (!original || state.sessionMode !== 'live') return;

        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const expectedTeamIndex = getTeamIndexForPick(
          replacement.pickNumber,
          state.config.totalTeams
        );
        const keeperPlayerIds = new Set(
          state.preloadedKeepers.map((keeper) => keeper.playerId)
        );
        const reservedKeeperPickNumbers = getKeeperPickNumbers(
          state.preloadedKeepers,
          state.config.totalTeams
        );
        const duplicatesAnotherPick = state.draftHistory.some(
          (pick, index) =>
            index !== originalIndex &&
            (
              pick.pickNumber === replacement.pickNumber ||
              pick.playerId === replacement.playerId
            )
        );
        const invalidReplacement =
          !Number.isInteger(replacement.pickNumber) ||
          replacement.pickNumber < 1 ||
          replacement.pickNumber > totalPicks ||
          replacement.teamIndex !== expectedTeamIndex ||
          keeperPlayerIds.has(replacement.playerId) ||
          reservedKeeperPickNumbers.has(replacement.pickNumber) ||
          duplicatesAnotherPick;
        if (invalidReplacement) return;

        const isUnchanged =
          original.pickNumber === replacement.pickNumber &&
          original.playerId === replacement.playerId &&
          original.playerName === replacement.playerName &&
          original.position === replacement.position &&
          original.teamIndex === replacement.teamIndex &&
          original.teamName === replacement.teamName;
        if (isUnchanged) return;

        let shortlistIndex = original.shortlistIndex;
        if (original.playerId !== replacement.playerId) {
          restoreShortlistedPlayer(state.shortlistedPlayerIds, original);
          shortlistIndex = state.shortlistedPlayerIds.indexOf(
            replacement.playerId
          );
          if (shortlistIndex >= 0) {
            state.shortlistedPlayerIds.splice(shortlistIndex, 1);
          }
        }

        state.draftHistory[originalIndex] = {
          ...replacement,
          timestamp: original.timestamp,
          source: 'provisional',
          provisionalRevision: (original.provisionalRevision ?? 0) + 1,
          provisionalUpdatedAt: Date.now(),
          ...(shortlistIndex !== undefined && shortlistIndex >= 0
            ? { shortlistIndex }
            : {}),
        };
        rebuildAfterProvisionalChange(state);
        corrected = true;
      });
      return corrected;
    },

    removeProvisionalPick: (pickNumber) => {
      let removed = false;
      set((state) => {
        if (state.sessionMode !== 'live') return;
        const pickIndex = state.draftHistory.findIndex(
          (pick) =>
            pick.pickNumber === pickNumber && pick.source === 'provisional'
        );
        const pick = state.draftHistory[pickIndex];
        if (!pick) return;

        restoreShortlistedPlayer(state.shortlistedPlayerIds, pick);
        state.draftHistory.splice(pickIndex, 1);
        rebuildAfterProvisionalChange(state);
        removed = true;
      });
      return removed;
    },

    reconcileSyncedPicks: (incomingPicks, nextPickNumber, unresolvedPicks = []) => {
      let result: DraftReconciliationResult = {
        changed: false,
        confirmations: [],
        corrections: [],
        removals: [],
        unresolvedIdentities: [],
      };
      set((state) => {
        const effectiveKeepers = getEffectiveKeeperAssignments(
          state.preloadedKeepers,
          incomingPicks,
          state.config.totalTeams
        );
        const keeperPickKeys = new Set(
          effectiveKeepers.map((keeper) => `${keeper.playerId}:${String(
            getPickNumberForTeamRound(
              keeper.teamIndex,
              keeper.round,
              state.config.totalTeams
            )
          )}`)
        );
        const keeperPickNumbers = getKeeperPickNumbers(
          effectiveKeepers,
          state.config.totalTeams
        );
        const ordinaryIncomingPicks = incomingPicks
          .filter(
            (pick) =>
              !keeperPickKeys.has(`${pick.playerId}:${String(pick.pickNumber)}`)
          )
          .sort((left, right) => left.pickNumber - right.pickNumber);
        const canonicalUnresolvedPicks = unresolvedPicks
          .filter((pick) => !keeperPickNumbers.has(pick.pickNumber))
          .map((pick) => ({ ...pick }))
          .sort((left, right) => left.pickNumber - right.pickNumber);
        const remotePickNumbers = new Set(
          ordinaryIncomingPicks.map((pick) => pick.pickNumber)
        );
        const existingPicksByNumber = new Map(
          state.draftHistory.map((pick) => [pick.pickNumber, pick])
        );
        const confirmations: ProvisionalPickConfirmation[] = [];
        const corrections: DraftPickCorrection[] = [];
        for (const incoming of ordinaryIncomingPicks) {
          const existing = existingPicksByNumber.get(incoming.pickNumber);
          if (!existing) continue;

          if (
            existing.source === 'provisional' &&
            existing.playerId === incoming.playerId
          ) {
            confirmations.push(toReconciledDraftPick(incoming));
            continue;
          }

          if (!hasSameProviderPick(existing, incoming)) {
            corrections.push({
              pickNumber: incoming.pickNumber,
              previous: toReconciledDraftPick(existing),
              provider: toReconciledDraftPick(incoming),
            });
          }
        }
        const removals = state.draftHistory.flatMap(
          (pick): DraftPickRemoval[] => {
            if (
              remotePickNumbers.has(pick.pickNumber) ||
              (
                pick.source !== 'manual' &&
                pick.source !== 'provisional' &&
                pick.source !== 'sync'
              )
            ) {
              return [];
            }

            return [{
              ...toReconciledDraftPick(pick),
              source: pick.source,
            }];
          }
        );
        const reconciledAt = Date.now();
        const remotePicks: RecordedDraftPick[] = ordinaryIncomingPicks.map((pick) => {
          const existing = existingPicksByNumber.get(pick.pickNumber);
          const canReuseConfirmedPick =
            existing?.source === 'sync' &&
            existing.playerId === pick.playerId &&
            existing.playerName === pick.playerName &&
            existing.position === pick.position &&
            existing.teamIndex === pick.teamIndex &&
            existing.teamName === pick.teamName;
          if (canReuseConfirmedPick) return existing;

          return {
            pickNumber: pick.pickNumber,
            playerId: pick.playerId,
            playerName: pick.playerName,
            position: pick.position,
            teamIndex: pick.teamIndex,
            teamName: pick.teamName,
            timestamp: reconciledAt,
            source: 'sync',
          };
        });
        const draftHistory = remotePicks;
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const canonicalNextPick = advancePastKeeperSlots(
          Math.min(totalPicks + 1, Math.max(1, Math.round(nextPickNumber))),
          effectiveKeepers,
          state.config.totalTeams,
          totalPicks
        );
        const historyChanged = !hasSameCanonicalHistory(
          state.draftHistory,
          draftHistory
        );
        const unresolvedIdentitiesChanged = !hasSameUnresolvedProviderPicks(
          state.unresolvedProviderPicks,
          canonicalUnresolvedPicks
        );
        if (
          !historyChanged &&
          !unresolvedIdentitiesChanged &&
          state.currentPick === canonicalNextPick
        ) {
          return;
        }

        for (const existing of state.draftHistory) {
          if (
            !ordinaryIncomingPicks.some(
              (incoming) => incoming.playerId === existing.playerId
            )
          ) {
            restoreShortlistedPlayer(state.shortlistedPlayerIds, existing);
          }
        }
        state.draftHistory = draftHistory;
        state.unresolvedProviderPicks = canonicalUnresolvedPicks;
        state.draftedPlayerIds = new Set([
          ...draftHistory.map((pick) => pick.playerId),
          ...effectiveKeepers.map((keeper) => keeper.playerId),
        ]);
        rebuildCanonicalRosters(state);
        state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
          (playerId) => !state.draftedPlayerIds.has(playerId)
        );
        state.currentPick = canonicalNextPick;
        state.mockSurvivalProbabilities = {};
        result = {
          changed: true,
          confirmations,
          corrections,
          removals,
          unresolvedIdentities: unresolvedIdentitiesChanged
            ? canonicalUnresolvedPicks
            : [],
        };
      });
      return result;
    },

    preloadKeepers: (keepers, supplyComplete = true) =>
      { set((state) => {
        // Canonical keeper supply: one deterministic assignment per kept
        // player at its configured team and round-selection cost, validated
        // before ordinary draft picks are applied.
        const supply = canonicalizeKeeperSupply(keepers, {
          totalTeams: state.config.totalTeams,
          totalRounds: state.config.totalRounds,
        });
        const supplyIsValid =
          supply.duplicatePlayerIds.length === 0 &&
          supply.invalidEntries.length === 0 &&
          supply.conflictingEntries.length === 0;
        const assignments = supplyIsValid && supplyComplete ? supply.assignments : [];
        const keeperPickKeys = new Set(
          assignments.map(
            (keeper) => `${keeper.playerId}:${String(keeper.pickNumber)}`
          )
        );
        state.draftHistory = state.draftHistory.filter(
          (pick) =>
            pick.source !== 'keeper' &&
            !keeperPickKeys.has(`${pick.playerId}:${String(pick.pickNumber)}`)
        );
        state.preloadedKeepers = assignments.map((keeper) => ({ ...keeper }));
        state.keepersInitialized = supplyIsValid && supplyComplete;
        const effectiveKeepers = getEffectiveKeeperAssignments(
          state.preloadedKeepers,
          state.draftHistory,
          state.config.totalTeams
        );
        state.draftedPlayerIds = new Set([
          ...state.draftHistory.map((pick) => pick.playerId),
          ...effectiveKeepers.map((keeper) => keeper.playerId),
        ]);
        rebuildCanonicalRosters(state);
        state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
          (playerId) => !state.draftedPlayerIds.has(playerId)
        );
        if (state.sessionMode === 'live') {
          state.currentPick = advancePastKeeperSlots(
            state.currentPick,
            effectiveKeepers,
            state.config.totalTeams,
            state.config.totalTeams * state.config.totalRounds
          );
        }
        state.mockSurvivalProbabilities = {};
      }); },

    consumeKeeperAtCurrentPick: () =>
      { set((state) => {
        const keeper = getKeeperAtPick(
          state.preloadedKeepers,
          state.currentPick,
          state.config.totalTeams
        );
        if (!keeper) return;
        if (state.draftHistory.some((pick) => pick.pickNumber === state.currentPick)) return;
        // A legacy synced keeper may already exist at another slot. The
        // canonical keeper still owns this slot, so advance instead of stalling.
        if (state.draftHistory.some((pick) => pick.playerId === keeper.playerId)) {
          state.currentPick += 1;
          state.mockSurvivalProbabilities = {};
          return;
        }

        const isMyKeeper = keeper.teamIndex === state.config.myPickPosition - 1;
        state.draftHistory.push({
          pickNumber: state.currentPick,
          playerId: keeper.playerId,
          playerName: keeper.playerName,
          position: keeper.position,
          teamIndex: keeper.teamIndex,
          teamName: isMyKeeper ? 'My Team' : `Team ${String(keeper.teamIndex + 1)}`,
          timestamp: Date.now(),
          source: 'keeper',
        });
        state.draftedPlayerIds.add(keeper.playerId);
        state.currentPick += 1;
        state.mockSurvivalProbabilities = {};
      }); },

    undoLastPick: () =>
      { set((state) => {
        const lastPick = state.draftHistory.pop();
        if (lastPick) {
          const effectiveKeepers = getEffectiveKeeperAssignments(
            state.preloadedKeepers,
            state.draftHistory,
            state.config.totalTeams
          );
          state.draftedPlayerIds = new Set([
            ...state.draftHistory.map((pick) => pick.playerId),
            ...effectiveKeepers.map((keeper) => keeper.playerId),
          ]);
          if (
            lastPick.shortlistIndex !== undefined &&
            !state.shortlistedPlayerIds.includes(lastPick.playerId)
          ) {
            state.shortlistedPlayerIds.splice(
              Math.min(lastPick.shortlistIndex, state.shortlistedPlayerIds.length),
              0,
              lastPick.playerId
            );
          }
          rebuildCanonicalRosters(state);
          state.currentPick = Math.max(1, lastPick.pickNumber);
          state.mockSurvivalProbabilities = {};
        }
      }); },

    branchFromPick: (pickNumber) =>
      { set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const branchPick = Math.min(totalPicks + 1, Math.max(1, Math.round(pickNumber)));
        state.draftHistory = state.draftHistory.filter(
          (pick) => pick.pickNumber < branchPick
        );
        const effectiveKeepers = getEffectiveKeeperAssignments(
          state.preloadedKeepers,
          state.draftHistory,
          state.config.totalTeams
        );
        state.draftedPlayerIds = new Set([
          ...effectiveKeepers.map((keeper) => keeper.playerId),
          ...state.draftHistory.map((pick) => pick.playerId),
        ]);
        rebuildCanonicalRosters(state);
        state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
          (playerId) => !state.draftedPlayerIds.has(playerId)
        );
        state.currentPick = branchPick;
        state.mockSurvivalProbabilities = {};
      }); },

    addToMyRoster: (player) =>
      { set((state) => {
        const position = player.position;
        addPlayerToRoster(state.myRoster, position, player.id);
        const teamRoster = state.teamRosters[state.config.myPickPosition - 1];
        if (teamRoster) addPlayerToRoster(teamRoster, position, player.id);
      }); },

    resetDraft: () =>
      { set((state) => {
        state.currentPick = 1;
        state.draftedPlayerIds = new Set(
          state.preloadedKeepers.map((keeper) => keeper.playerId)
        );
        state.draftHistory = [];
        state.unresolvedProviderPicks = [];
        rebuildCanonicalRosters(state);
        state.shortlistedPlayerIds = [];
        state.mockSurvivalProbabilities = {};
      }); },

    setMockSurvivalProbabilities: (probabilities) => {
      set((state) => {
        state.mockSurvivalProbabilities = { ...probabilities };
      });
    },

    togglePlayerShortlisted: (playerId) => {
      set((state) => {
        const index = state.shortlistedPlayerIds.indexOf(playerId);
        if (index >= 0) {
          state.shortlistedPlayerIds.splice(index, 1);
          return;
        }

        if (!state.draftedPlayerIds.has(playerId)) {
          state.shortlistedPlayerIds.push(playerId);
        }
      });
    },

    removePlayerFromShortlist: (playerId) => {
      set((state) => {
        state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
          (shortlistedPlayerId) => shortlistedPlayerId !== playerId
        );
      });
    },

    // UI actions
    setDecisionLens: (lens) =>
      { set((state) => {
        state.decisionLens = lens;
      }); },

    setPositionFilter: (position) =>
      { set((state) => {
        state.filter.position = position;
      }); },

    setHideNonStarters: (hide) =>
      { set((state) => {
        state.filter.hideNonStarters = hide;
      }); },

    setSearchQuery: (query) =>
      { set((state) => {
        state.filter.searchQuery = query;
      }); },

    setSort: (field, direction) =>
      { set((state) => {
        if (state.sort.field === field && !direction) {
          // Toggle direction if same field clicked
          state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort.field = field;
          state.sort.direction = direction ?? 'asc';
        }
      }); },

    toggleSortDirection: () =>
      { set((state) => {
        state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
      }); },
    }))
  );
}

export type DraftStoreApi = ReturnType<typeof createDraftStore>;

const defaultDraftStore = createDraftStore();
const DraftStoreContext = createContext<DraftStoreApi | null>(null);

export function DraftStoreProvider({
  children,
  store,
}: {
  readonly children: ReactNode;
  readonly store: DraftStoreApi;
}) {
  return createElement(DraftStoreContext.Provider, { value: store }, children);
}

export function useDraftStoreApi(): DraftStoreApi {
  return useContext(DraftStoreContext) ?? defaultDraftStore;
}

interface UseDraftStore {
  <T>(selector: (state: DraftStore) => T): T;
  readonly getState: DraftStoreApi['getState'];
  readonly getInitialState: DraftStoreApi['getInitialState'];
  readonly setState: DraftStoreApi['setState'];
  readonly subscribe: DraftStoreApi['subscribe'];
}

function useDraftStoreSelector<T>(selector: (state: DraftStore) => T): T {
  return useStore(useDraftStoreApi(), selector);
}

export const useDraftStore: UseDraftStore = Object.assign(
  useDraftStoreSelector,
  {
    getState: defaultDraftStore.getState.bind(defaultDraftStore),
    getInitialState: defaultDraftStore.getInitialState.bind(defaultDraftStore),
    setState: defaultDraftStore.setState.bind(defaultDraftStore),
    subscribe: defaultDraftStore.subscribe.bind(defaultDraftStore),
  }
);

/**
 * Selector hooks for common state slices
 */
export const useCurrentPick = () => useDraftStore((state) => state.currentPick);
export const useDraftedIds = () => useDraftStore((state) => state.draftedPlayerIds);
export const useShortlistedIds = (): DraftState['shortlistedPlayerIds'] =>
  useDraftStore((state) => state.shortlistedPlayerIds);
export const useMyRoster = () => useDraftStore((state) => state.myRoster);
export const useFilter = () => useDraftStore((state) => state.filter);
export const useSort = () => useDraftStore((state) => state.sort);
export const useDraftConfig = () => useDraftStore((state) => state.config);
export const useDraftSessionMode = (): DraftSessionMode =>
  useDraftStore((state) => state.sessionMode);
export const useDecisionLens = (): DecisionLens =>
  useDraftStore((state) => state.decisionLens);
export const useIsMyTurn = () =>
  useDraftStore((state) =>
    calculateIsMyTurn(
      state.currentPick,
      state.config.myPickPosition,
      state.config.totalTeams
    )
  );
