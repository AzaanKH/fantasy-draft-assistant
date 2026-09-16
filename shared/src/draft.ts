import type { Position, SurvivalModelSource, TierSource } from './player';

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
  K: { starters: 1, max: 1 },
  DEF: { starters: 0, max: 0 },
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
export const NEED_PRIORITIES = ['critical', 'high', 'medium', 'low', 'defer', 'filled'] as const;

export type NeedPriority = (typeof NEED_PRIORITIES)[number];

/**
 * Positional need assessment for team building
 */
export interface PositionNeed {
  readonly position: Position;
  readonly priority: NeedPriority;
  /** Fixed, position-specific starter slots filled. */
  readonly startersFilled: number;
  /** Fixed, position-specific starter slots required. */
  readonly startersNeeded: number;
  /** Shared FLEX starter slots currently filled by surplus eligible players. */
  readonly flexSlotsFilled: number;
  /** Shared FLEX starter slots in the configured league format. */
  readonly flexSlotsNeeded: number;
  /** Whether this position can fill one of the configured FLEX slots. */
  readonly isFlexEligible: boolean;
  readonly scarcityScore: number;
}

/** Best same-position fallback expected to remain available at the next selection. */
export interface ExpectedNextPickAlternative {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly ecrRank: number;
  readonly valueOverReplacement: number;
  readonly returnProbability: number;
  readonly expectedValue: number;
}

/** Transparent inputs used by the live, ECR-anchored Best Pick policy. */
export interface RecommendationDecisionFactors {
  readonly playerQuality: {
    readonly ecrRank: number;
    readonly score: number;
  };
  readonly leagueValue: {
    readonly score: number;
    readonly minScore: number;
    readonly maxScore: number;
    readonly projectedPoints: number;
    readonly replacementPoints: number;
    readonly valueOverReplacement: number;
    readonly scoringAdjustment?: number;
    readonly materiallyChangedOrdering?: boolean;
  };
  readonly rosterFit: {
    readonly score: number;
    readonly minScore: number;
    readonly maxScore: number;
    readonly fixedStartersOpen: number;
    readonly flexSlotsOpen: number;
    readonly benchSlotsOpen: number;
    readonly selectionsRemaining: number;
    readonly legalCompletionPossible: boolean;
    readonly materiallyChangedOrdering?: boolean;
  };
  readonly tierSupply: {
    readonly score: number;
    readonly minScore: number;
    readonly maxScore: number;
    readonly currentTier: number;
    readonly remainingInTier: number;
    readonly nextTier?: number;
    readonly nextTierProjectedPoints?: number;
    readonly dropoffPoints: number;
    readonly meaningfulCliff: boolean;
    readonly costOfWaiting: number;
    readonly materiallyChangedOrdering: boolean;
  };
  readonly draftTiming: {
    readonly score: number;
    readonly minScore: number;
    readonly maxScore: number;
    readonly nextPickNumber?: number;
    readonly nextPickLabel?: string;
    readonly picksUntilNextPick?: number;
    readonly returnProbability?: number;
    readonly candidateValue: number;
    readonly expectedAlternative?: ExpectedNextPickAlternative;
    readonly costOfWaiting: number;
    readonly source?: SurvivalModelSource;
    readonly materiallyChangedOrdering: boolean;
  };
  readonly conservativeBoundary: {
    readonly ecrRankLimit: number;
    readonly samePositionTier: boolean;
    readonly withinBoundary: boolean;
    readonly feasibilityException: boolean;
  };
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
  /** Present on live Best Pick results; absent from the ECR-only Best Player view. */
  readonly decisionFactors?: RecommendationDecisionFactors;
  readonly diagnostics?: {
    readonly expertRank: number;
    readonly marketRank: number;
    readonly marketDelta: number;
    /** Picks paid ahead of the league-adjusted market price at the current pick. */
    readonly marketReachCost?: number;
    readonly projectedPoints: number;
    readonly valueOverReplacement: number;
    readonly tier: number;
    readonly fantasyProsTier?: number;
    readonly tierSource?: TierSource;
    readonly tierDropoffPoints?: number;
    readonly tierRemaining?: number;
    readonly isLastInTier?: boolean;
    readonly nextPickSurvivalProbability?: number;
    readonly nextPickNumber?: number;
    readonly nextPickLabel?: string;
    readonly picksUntilNextPick?: number;
    readonly survivalModelSource?: SurvivalModelSource;
    readonly historicalExpectedPick?: number;
    readonly consensusMarketPick?: number;
    readonly sleeperTimingPick?: number;
    readonly survivalModelSampleSize?: number;
    readonly leagueAdjustedMarketRank?: number;
    readonly leagueMarketDelta?: number;
    readonly leaguePositionTendency?: string;
    readonly pickEv?: number;
    readonly ecrAnchorValue?: number;
    readonly projectionResidualValue?: number;
    readonly marginalRosterValue?: number;
    readonly costOfWaiting?: number;
    readonly lateRoundOptionValue?: number;
    readonly riskAdjustedLoss?: number;
    readonly replacementPoints?: number;
    readonly expectedNextPickAlternativeValue?: number;
    readonly expectedNextPickAlternative?: ExpectedNextPickAlternative;
    readonly nextPickCostOfWaiting?: number;
  };
  readonly subScores?: {
    readonly expertRankScore: number;
    readonly marketValueScore: number;
    readonly projectionScore: number;
    readonly replacementScore: number;
    readonly upsideScore: number;
    readonly tierUrgencyScore: number;
    readonly survivalScore: number;
    readonly rosterNeedScore?: number;
    readonly scarcityScore?: number;
    readonly draftStateScore?: number;
    readonly riskPenalty: number;
    readonly uncertaintyPenalty: number;
    readonly needMultiplier?: number;
    readonly scarcityMultiplier?: number;
    readonly tePremiumBoost?: number;
    readonly pickEv?: number;
    readonly ecrAnchorValue?: number;
    readonly projectionResidualValue?: number;
    readonly marginalRosterValue?: number;
    readonly costOfWaiting?: number;
    readonly lateRoundOptionValue?: number;
    readonly riskAdjustedLoss?: number;
  };
}

/**
 * Manager-selectable perspectives over the same available-player set.
 * Best Pick is the roster-completion policy; Best Player is the untouched ECR reference.
 */
export const DECISION_LENSES = ['best-pick', 'best-player'] as const;

export type DecisionLens = (typeof DECISION_LENSES)[number];

export const DECISION_DIVERGENCE_FACTORS = [
  'league-value',
  'roster-fit',
  'tier-supply',
  'draft-timing',
] as const;

export type DecisionDivergenceFactor =
  (typeof DECISION_DIVERGENCE_FACTORS)[number];

/**
 * Canonical answer shared by every rendered draft-decision surface.
 */
export interface DecisionOutput {
  readonly bestPick: Recommendation | null;
  readonly bestPlayer: Recommendation | null;
  readonly selectedLens: DecisionLens;
  readonly selected: Recommendation | null;
  readonly decisionDivergence: boolean;
  readonly decisionDivergenceFactor: DecisionDivergenceFactor | null;
  readonly decisionDivergenceExplanation: string | null;
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
