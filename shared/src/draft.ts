import type { Position } from './player';

/**
 * Roster structure tracking player IDs by position
 */
export interface Roster {
  readonly QB: readonly string[];
  readonly RB: readonly string[];
  readonly WR: readonly string[];
  readonly TE: readonly string[];
  readonly K: readonly string[];
  readonly DEF: readonly string[];
}

/**
 * Creates an empty roster with no players
 */
export function createEmptyRoster(): Roster {
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
 * Position slot requirements for starters and max roster
 */
export interface PositionRequirement {
  readonly starters: number;
  readonly max: number;
}

/**
 * FLEX position configuration
 */
export interface FlexRequirement {
  readonly starters: number;
  readonly eligiblePositions: readonly Position[];
}

/**
 * Complete roster requirements for the league
 * 10-team keeper league configuration
 */
export interface RosterRequirements {
  readonly QB: PositionRequirement;
  readonly RB: PositionRequirement;
  readonly WR: PositionRequirement;
  readonly TE: PositionRequirement;
  readonly FLEX: FlexRequirement;
  readonly K: PositionRequirement;
  readonly DEF: PositionRequirement;
  readonly BENCH: { readonly spots: number };
}

/**
 * Default roster requirements for 10-team league
 */
export const DEFAULT_ROSTER_REQUIREMENTS: RosterRequirements = {
  QB: { starters: 1, max: 4 },
  RB: { starters: 2, max: 8 },
  WR: { starters: 2, max: 8 },
  TE: { starters: 1, max: 3 },
  FLEX: { starters: 2, eligiblePositions: ['RB', 'WR', 'TE'] },
  K: { starters: 1, max: 3 },
  DEF: { starters: 1, max: 3 },
  BENCH: { spots: 5 },
} as const;

/**
 * Current state of the draft
 */
export interface DraftState {
  /** Set of player IDs that have been drafted */
  readonly draftedPlayerIds: ReadonlySet<string>;
  /** Current user's roster */
  readonly myRoster: Roster;
  /** Current pick number (1-indexed) */
  readonly currentPick: number;
  /** Total picks in the draft */
  readonly totalPicks: number;
  /** User's position in snake draft (1-10) */
  readonly myPickPosition: number;
  /** Whether it's currently the user's turn to pick */
  readonly isMyTurn: boolean;
}

/**
 * Individual draft pick record
 */
export interface DraftPick {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly teamIndex: number;
  readonly teamName: string;
  readonly position: Position;
  readonly timestamp: number;
}

/**
 * Priority levels for team positional needs
 */
export const NEED_PRIORITIES = ['critical', 'high', 'medium', 'low', 'filled'] as const;

export type NeedPriority = (typeof NEED_PRIORITIES)[number];

/**
 * Positional need assessment for team building
 */
export interface PositionNeed {
  readonly position: Position;
  readonly priority: NeedPriority;
  readonly startersFilled: number;
  readonly startersNeeded: number;
  readonly scarcityScore: number;
}

/**
 * Player recommendation with reasoning
 */
export interface Recommendation {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly reason: string;
  readonly score: number;
}

/**
 * Creates the initial draft state
 */
export function createInitialDraftState(
  totalPicks: number,
  myPickPosition: number
): DraftState {
  return {
    draftedPlayerIds: new Set<string>(),
    myRoster: createEmptyRoster(),
    currentPick: 1,
    totalPicks,
    myPickPosition,
    isMyTurn: myPickPosition === 1,
  };
}

/**
 * Type guard to check if a value is a valid NeedPriority
 */
export function isNeedPriority(value: unknown): value is NeedPriority {
  return typeof value === 'string' && NEED_PRIORITIES.includes(value as NeedPriority);
}
