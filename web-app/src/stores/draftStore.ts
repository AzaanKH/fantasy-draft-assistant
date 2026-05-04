/**
 * Draft State Store (Zustand)
 *
 * Manages draft state including:
 * - Drafted players tracking
 * - User's roster
 * - Current pick and turn status
 * - Position filtering and sorting
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

// Enable Immer support for Set and Map
enableMapSet();
import type {
  Player,
  Position,
  DraftPick,
} from '@fantasy-draft/shared';
import type { SortField, SortDirection } from '@/lib/calculations';

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
interface DraftConfig {
  totalTeams: number;
  totalRounds: number;
  myPickPosition: number;
}

/**
 * Complete draft store state
 */
interface DraftState {
  // Draft configuration
  config: DraftConfig;

  // Draft progress
  currentPick: number;
  draftedPlayerIds: Set<string>;
  draftHistory: DraftPick[];

  // My team
  myRoster: MutableRoster;

  // UI state
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
  // Configuration
  setConfig: (config: Partial<DraftConfig>) => void;

  // Draft actions
  markPlayerDrafted: (
    playerId: string,
    playerName: string,
    position: Position,
    teamIndex: number,
    teamName: string,
    pickNumber?: number
  ) => void;
  undoLastPick: () => void;
  addToMyRoster: (player: Player) => void;
  resetDraft: () => void;

  // UI actions
  setPositionFilter: (position: Position | 'ALL') => void;
  setHideNonStarters: (hide: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSort: (field: SortField, direction?: SortDirection) => void;
  toggleSortDirection: () => void;
}

type DraftStore = DraftState & DraftActions;

/**
 * Calculate if it's the user's turn based on snake draft order
 */
function calculateIsMyTurn(
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
 * Default draft configuration (10-team, 15 rounds)
 */
const defaultConfig: DraftConfig = {
  totalTeams: 10,
  totalRounds: 15,
  myPickPosition: 1,
};

/**
 * Create the draft store with Zustand + immer for immutable updates
 */
export const useDraftStore = create<DraftStore>()(
  immer((set, get) => ({
    // Initial state
    config: defaultConfig,
    currentPick: 1,
    draftedPlayerIds: new Set<string>(),
    draftHistory: [],
    myRoster: createEmptyMutableRoster(),
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
    setConfig: (newConfig) =>
      set((state) => {
        Object.assign(state.config, newConfig);
      }),

    // Draft actions
    markPlayerDrafted: (playerId, playerName, position, teamIndex, teamName, pickNumber) =>
      set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const pickNumberToUse = pickNumber ?? state.currentPick;

        if (pickNumberToUse < 1 || pickNumberToUse > totalPicks) {
          return;
        }

        if (state.draftedPlayerIds.has(playerId)) {
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

        state.draftedPlayerIds.add(playerId);
        state.draftHistory.push({
          pickNumber: pickNumberToUse,
          playerId,
          playerName,
          position,
          teamIndex,
          teamName,
          timestamp: Date.now(),
        });
        if (pickNumber !== undefined) {
          state.currentPick = Math.max(state.currentPick, pickNumberToUse + 1);
        } else {
          state.currentPick += 1;
        }
      }),

    undoLastPick: () =>
      set((state) => {
        const lastPick = state.draftHistory.pop();
        if (lastPick) {
          state.draftedPlayerIds.delete(lastPick.playerId);
          if (lastPick.teamName === 'My Team') {
            const roster = state.myRoster[lastPick.position] as string[];
            const index = roster.lastIndexOf(lastPick.playerId);
            if (index >= 0) {
              roster.splice(index, 1);
            }
          }
          state.currentPick = Math.max(1, lastPick.pickNumber);
        }
      }),

    addToMyRoster: (player) =>
      set((state) => {
        const position = player.position;
        // Cast to mutable array for immer
        const roster = state.myRoster[position] as string[];
        roster.push(player.id);
      }),

    resetDraft: () =>
      set((state) => {
        state.currentPick = 1;
        state.draftedPlayerIds = new Set<string>();
        state.draftHistory = [];
        state.myRoster = createEmptyMutableRoster();
      }),

    // UI actions
    setPositionFilter: (position) =>
      set((state) => {
        state.filter.position = position;
      }),

    setHideNonStarters: (hide) =>
      set((state) => {
        state.filter.hideNonStarters = hide;
      }),

    setSearchQuery: (query) =>
      set((state) => {
        state.filter.searchQuery = query;
      }),

    setSort: (field, direction) =>
      set((state) => {
        if (state.sort.field === field && !direction) {
          // Toggle direction if same field clicked
          state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort.field = field;
          state.sort.direction = direction ?? 'asc';
        }
      }),

    toggleSortDirection: () =>
      set((state) => {
        state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
      }),
  }))
);

/**
 * Selector hooks for common state slices
 */
export const useCurrentPick = () => useDraftStore((state) => state.currentPick);
export const useDraftedIds = () => useDraftStore((state) => state.draftedPlayerIds);
export const useMyRoster = () => useDraftStore((state) => state.myRoster);
export const useFilter = () => useDraftStore((state) => state.filter);
export const useSort = () => useDraftStore((state) => state.sort);
export const useDraftConfig = () => useDraftStore((state) => state.config);
