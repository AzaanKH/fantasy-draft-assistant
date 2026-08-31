import {
  DEFAULT_ROSTER_REQUIREMENTS,
  POSITIONS,
  type Player,
  type Position,
  type RecommendationDecisionFactors,
  type RosterRequirements,
} from '@fantasy-draft/shared';
import {
  calculateTierAvailability,
  getTierKey,
  type TierAvailability,
} from './tiers';

/** Normal Best Pick choices cannot move beyond this ECR neighborhood. */
export const BEST_PICK_ECR_NEIGHBORHOOD = 8;
/** League scoring and replacement value can add at most six policy points. */
export const BEST_PICK_LEAGUE_VALUE_MAX = 6;
/** Roster construction can add at most eight policy points. */
export const BEST_PICK_ROSTER_FIT_MAX = 8;
/** Tier supply can add at most four cost-of-waiting policy points. */
export const BEST_PICK_TIER_SUPPLY_MAX = 4;
/** Next-pick timing can add at most four policy points. */
export const BEST_PICK_DRAFT_TIMING_MAX = 4;

const LEAGUE_VOR_POINTS_PER_POLICY_POINT = 24;
const TIER_DROPOFF_POINTS_PER_POLICY_POINT = 8;
const TIMING_VALUE_POINTS_PER_POLICY_POINT = 8;

export interface BestPickPolicyContext {
  readonly requirements?: RosterRequirements;
  readonly rosterCounts?: Readonly<Partial<Record<Position, number>>>;
  /** Manager selections left, including the current selection. */
  readonly selectionsRemaining?: number;
}

export interface BestPickPolicyEvaluation {
  readonly player: Player;
  readonly score: number;
  readonly factors: RecommendationDecisionFactors;
}

export interface BestPickPolicyResult {
  readonly evaluations: readonly BestPickPolicyEvaluation[];
  readonly preferredPlayerId?: string;
  readonly feasibilityException: boolean;
}

interface RosterAnalysis {
  readonly rosterSize: number;
  readonly rosterCapacity: number;
  readonly fixedStartersOpen: number;
  readonly fixedStartersOpenByPosition: Readonly<Record<Position, number>>;
  readonly flexSlotsOpen: number;
  readonly benchSlotsOpen: number;
  readonly minimumStarterPicks: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits));
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function getCounts(
  counts: Readonly<Partial<Record<Position, number>>> | undefined
): Record<Position, number> {
  return {
    QB: Math.max(0, Math.round(counts?.QB ?? 0)),
    RB: Math.max(0, Math.round(counts?.RB ?? 0)),
    WR: Math.max(0, Math.round(counts?.WR ?? 0)),
    TE: Math.max(0, Math.round(counts?.TE ?? 0)),
    K: Math.max(0, Math.round(counts?.K ?? 0)),
    DEF: Math.max(0, Math.round(counts?.DEF ?? 0)),
  };
}

function getRosterCapacity(requirements: RosterRequirements): number {
  return POSITIONS.reduce(
    (total, position) => total + requirements[position].starters,
    requirements.FLEX.starters + requirements.BENCH.spots
  );
}

function analyzeRoster(
  counts: Readonly<Record<Position, number>>,
  requirements: RosterRequirements
): RosterAnalysis {
  const fixedStartersOpenByPosition = {} as Record<Position, number>;
  let fixedStartersOpen = 0;
  let fixedStartersFilled = 0;
  let rosterSize = 0;

  for (const position of POSITIONS) {
    const count = counts[position];
    const starters = requirements[position].starters;
    const open = Math.max(0, starters - count);
    fixedStartersOpenByPosition[position] = open;
    fixedStartersOpen += open;
    fixedStartersFilled += Math.min(count, starters);
    rosterSize += count;
  }

  const flexEligibleSurplus = requirements.FLEX.eligiblePositions.reduce(
    (total, position) =>
      total + Math.max(0, counts[position] - requirements[position].starters),
    0
  );
  const flexSlotsFilled = Math.min(
    requirements.FLEX.starters,
    flexEligibleSurplus
  );
  const flexSlotsOpen = requirements.FLEX.starters - flexSlotsFilled;
  const benchPlayers = Math.max(
    0,
    rosterSize - fixedStartersFilled - flexSlotsFilled
  );

  return {
    rosterSize,
    rosterCapacity: getRosterCapacity(requirements),
    fixedStartersOpen,
    fixedStartersOpenByPosition,
    flexSlotsOpen,
    benchSlotsOpen: Math.max(0, requirements.BENCH.spots - benchPlayers),
    minimumStarterPicks: fixedStartersOpen + flexSlotsOpen,
  };
}

function addCandidate(
  counts: Readonly<Record<Position, number>>,
  position: Position
): Record<Position, number> {
  return {
    ...counts,
    [position]: counts[position] + 1,
  };
}

function canCompleteLegalRoster(
  player: Player,
  counts: Readonly<Record<Position, number>>,
  requirements: RosterRequirements,
  selectionsRemaining: number
): boolean {
  if (
    selectionsRemaining < 1 ||
    counts[player.position] >= requirements[player.position].max
  ) {
    return false;
  }

  const afterCounts = addCandidate(counts, player.position);
  const after = analyzeRoster(afterCounts, requirements);
  const futureSelections = selectionsRemaining - 1;

  if (
    after.rosterSize > after.rosterCapacity ||
    after.rosterSize + futureSelections !== after.rosterCapacity ||
    after.minimumStarterPicks > futureSelections
  ) {
    return false;
  }

  for (const position of POSITIONS) {
    if (
      afterCounts[position] > requirements[position].max ||
      requirements[position].max - afterCounts[position] <
        after.fixedStartersOpenByPosition[position]
    ) {
      return false;
    }
  }

  const flexCapacityAfterFixedStarters = requirements.FLEX.eligiblePositions.reduce(
    (total, position) =>
      total + Math.max(
        0,
        requirements[position].max -
          afterCounts[position] -
          after.fixedStartersOpenByPosition[position]
      ),
    0
  );
  if (flexCapacityAfterFixedStarters < after.flexSlotsOpen) {
    return false;
  }

  const totalPositionCapacity = POSITIONS.reduce(
    (total, position) =>
      total + Math.max(0, requirements[position].max - afterCounts[position]),
    0
  );
  return totalPositionCapacity >= futureSelections;
}

function getRosterFitScore(
  player: Player,
  before: RosterAnalysis,
  after: RosterAnalysis,
  selectionsRemaining: number
): number {
  const fixedStarterGain =
    before.fixedStartersOpenByPosition[player.position] -
    after.fixedStartersOpenByPosition[player.position];
  const flexGain = before.flexSlotsOpen - after.flexSlotsOpen;
  let score = fixedStarterGain > 0 ? 6 : flexGain > 0 ? 4 : 1;

  if (
    fixedStarterGain + flexGain > 0 &&
    selectionsRemaining <= before.minimumStarterPicks + 1
  ) {
    score += 2;
  }

  return round(clamp(score, 0, BEST_PICK_ROSTER_FIT_MAX));
}

function getTierSupplyFactor(
  player: Player,
  availability: TierAvailability | undefined
): RecommendationDecisionFactors['tierSupply'] {
  const remainingInTier = availability?.remaining ?? 0;
  const dropoffPoints = availability?.dropoffPoints ?? 0;
  const meaningfulCliff = availability?.isMeaningfulCliff === true;
  const costOfWaiting = meaningfulCliff &&
    availability?.nextTier !== undefined &&
    remainingInTier > 0
    ? round(clamp(
        dropoffPoints /
          TIER_DROPOFF_POINTS_PER_POLICY_POINT /
          remainingInTier,
        0,
        BEST_PICK_TIER_SUPPLY_MAX
      ))
    : 0;

  return {
    score: costOfWaiting,
    minScore: 0,
    maxScore: BEST_PICK_TIER_SUPPLY_MAX,
    currentTier: player.tier,
    remainingInTier,
    nextTier: availability?.nextTier,
    nextTierProjectedPoints: availability?.nextTierProjectedPoints,
    dropoffPoints,
    meaningfulCliff,
    costOfWaiting,
    materiallyChangedOrdering: false,
  };
}

function getDraftTimingFactor(
  player: Player,
  candidates: readonly Player[]
): RecommendationDecisionFactors['draftTiming'] {
  const candidateValue = round(Math.max(0, player.valueOverReplacement), 1);
  const nextPickNumber = player.nextPickNumber;
  if (nextPickNumber === undefined) {
    return {
      score: 0,
      minScore: 0,
      maxScore: BEST_PICK_DRAFT_TIMING_MAX,
      candidateValue,
      costOfWaiting: 0,
      source: player.survivalModelSource,
      materiallyChangedOrdering: false,
    };
  }

  const expectedAlternatives = candidates
    .filter((candidate) =>
      candidate.id !== player.id &&
      candidate.position === player.position
    )
    .map((candidate) => {
      const returnProbability = clamp(
        candidate.nextPickSurvivalProbability,
        0,
        1
      );
      const valueOverReplacement = round(
        Math.max(0, candidate.valueOverReplacement),
        1
      );
      return {
        playerId: candidate.id,
        playerName: candidate.name,
        position: candidate.position,
        ecrRank: candidate.ecrRank,
        valueOverReplacement,
        returnProbability,
        expectedValue: round(valueOverReplacement * returnProbability, 1),
      };
    })
    .sort((left, right) =>
      right.expectedValue - left.expectedValue ||
      left.ecrRank - right.ecrRank ||
      compareText(left.playerName, right.playerName) ||
      compareText(left.playerId, right.playerId)
    );
  const expectedAlternative = expectedAlternatives[0];
  const returnProbability = clamp(
    player.nextPickSurvivalProbability,
    0,
    1
  );
  const costOfWaiting = round(
    (1 - returnProbability) * Math.max(
      0,
      candidateValue - (expectedAlternative?.expectedValue ?? 0)
    ),
    1
  );
  const score = round(clamp(
    costOfWaiting / TIMING_VALUE_POINTS_PER_POLICY_POINT,
    0,
    BEST_PICK_DRAFT_TIMING_MAX
  ));

  return {
    score,
    minScore: 0,
    maxScore: BEST_PICK_DRAFT_TIMING_MAX,
    nextPickNumber,
    nextPickLabel: player.nextPickLabel,
    picksUntilNextPick: player.picksUntilNextPick,
    returnProbability,
    candidateValue,
    expectedAlternative,
    costOfWaiting,
    source: player.survivalModelSource,
    materiallyChangedOrdering: false,
  };
}

function compareEvaluations(
  left: BestPickPolicyEvaluation,
  right: BestPickPolicyEvaluation,
  score: (evaluation: BestPickPolicyEvaluation) => number =
    (evaluation) => evaluation.score,
  enforceRosterFeasibility: boolean = true
): number {
  return (
    (enforceRosterFeasibility
      ? Number(right.factors.rosterFit.legalCompletionPossible) -
        Number(left.factors.rosterFit.legalCompletionPossible)
      : 0) ||
    score(right) - score(left) ||
    left.player.ecrRank - right.player.ecrRank ||
    compareText(left.player.name, right.player.name) ||
    compareText(left.player.id, right.player.id)
  );
}

function selectEvaluation(
  evaluations: readonly BestPickPolicyEvaluation[],
  score: (evaluation: BestPickPolicyEvaluation) => number,
  enforceRosterFeasibility: boolean = true
): BestPickPolicyEvaluation | undefined {
  const sort = (left: BestPickPolicyEvaluation, right: BestPickPolicyEvaluation) =>
    compareEvaluations(left, right, score, enforceRosterFeasibility);
  if (!enforceRosterFeasibility) {
    const bounded = evaluations
      .filter((evaluation) => evaluation.factors.conservativeBoundary.withinBoundary)
      .sort(sort);
    return bounded[0] ?? [...evaluations].sort(sort)[0];
  }
  const boundedFeasible = evaluations
    .filter((evaluation) =>
      evaluation.factors.conservativeBoundary.withinBoundary &&
      evaluation.factors.rosterFit.legalCompletionPossible
    )
    .sort(sort);
  const allFeasible = evaluations
    .filter((evaluation) => evaluation.factors.rosterFit.legalCompletionPossible)
    .sort(sort);
  const bounded = evaluations
    .filter((evaluation) => evaluation.factors.conservativeBoundary.withinBoundary)
    .sort(sort);

  return boundedFeasible[0] ?? allFeasible[0] ?? bounded[0] ??
    [...evaluations].sort(sort)[0];
}

/**
 * Applies the live Primary League policy around the untouched ECR champion.
 * The only path outside the normal tier/rank boundary is legal-roster rescue.
 */
export function evaluateBestPickPolicy(
  availablePlayers: readonly Player[],
  candidatePlayers: readonly Player[],
  context: BestPickPolicyContext = {}
): BestPickPolicyResult {
  const requirements = context.requirements ?? DEFAULT_ROSTER_REQUIREMENTS;
  const counts = getCounts(context.rosterCounts);
  const before = analyzeRoster(counts, requirements);
  const selectionsRemaining = Math.max(
    0,
    Math.round(
      context.selectionsRemaining ?? before.rosterCapacity - before.rosterSize
    )
  );
  const ecrChampion = [...availablePlayers].sort((left, right) =>
    left.ecrRank - right.ecrRank ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  )[0];

  if (!ecrChampion || candidatePlayers.length === 0) {
    return {
      evaluations: [],
      preferredPlayerId: undefined,
      feasibilityException: false,
    };
  }

  const ecrRankLimit = ecrChampion.ecrRank + BEST_PICK_ECR_NEIGHBORHOOD;
  const tierAvailability = calculateTierAvailability(candidatePlayers);
  const evaluations = candidatePlayers.map((player): BestPickPolicyEvaluation => {
    const after = analyzeRoster(addCandidate(counts, player.position), requirements);
    const samePositionTier =
      player.position === ecrChampion.position && player.tier === ecrChampion.tier;
    const withinBoundary =
      player.ecrRank <= ecrRankLimit || samePositionTier;
    const leagueValueScore = round(clamp(
      Math.max(0, player.valueOverReplacement) /
        LEAGUE_VOR_POINTS_PER_POLICY_POINT,
      0,
      BEST_PICK_LEAGUE_VALUE_MAX
    ));
    const rosterFitScore = getRosterFitScore(
      player,
      before,
      after,
      selectionsRemaining
    );
    const tierSupply = getTierSupplyFactor(
      player,
      tierAvailability.get(getTierKey(player.position, player.tier))
    );
    const draftTiming = getDraftTimingFactor(player, candidatePlayers);
    const playerQualityScore = -player.ecrRank;
    const legalCompletionPossible = canCompleteLegalRoster(
      player,
      counts,
      requirements,
      selectionsRemaining
    );

    return {
      player,
      score: round(
        playerQualityScore + leagueValueScore + rosterFitScore +
          tierSupply.score + draftTiming.score
      ),
      factors: {
        playerQuality: {
          ecrRank: player.ecrRank,
          score: playerQualityScore,
        },
        leagueValue: {
          score: leagueValueScore,
          minScore: 0,
          maxScore: BEST_PICK_LEAGUE_VALUE_MAX,
          projectedPoints: player.projectedPoints,
          replacementPoints: round(
            player.projectedPoints - player.valueOverReplacement,
            1
          ),
          valueOverReplacement: player.valueOverReplacement,
          materiallyChangedOrdering: false,
          ...(player.leagueScoringAdjustment === undefined
            ? {}
            : { scoringAdjustment: player.leagueScoringAdjustment }),
        },
        rosterFit: {
          score: rosterFitScore,
          minScore: 0,
          maxScore: BEST_PICK_ROSTER_FIT_MAX,
          fixedStartersOpen: before.fixedStartersOpen,
          flexSlotsOpen: before.flexSlotsOpen,
          benchSlotsOpen: before.benchSlotsOpen,
          selectionsRemaining,
          legalCompletionPossible,
          materiallyChangedOrdering: false,
        },
        tierSupply,
        draftTiming,
        conservativeBoundary: {
          ecrRankLimit,
          samePositionTier,
          withinBoundary,
          feasibilityException: false,
        },
      },
    };
  });

  const selected = selectEvaluation(evaluations, (evaluation) => evaluation.score);
  const selectedWithoutLeagueValue = selectEvaluation(
    evaluations,
    (evaluation) => evaluation.score - evaluation.factors.leagueValue.score
  );
  const selectedWithoutRosterFit = selectEvaluation(
    evaluations,
    (evaluation) => evaluation.score - evaluation.factors.rosterFit.score,
    false
  );
  const selectedWithoutTierSupply = selectEvaluation(
    evaluations,
    (evaluation) => evaluation.score - evaluation.factors.tierSupply.score
  );
  const selectedWithoutDraftTiming = selectEvaluation(
    evaluations,
    (evaluation) => evaluation.score - evaluation.factors.draftTiming.score
  );
  const tierSupplyChangedOrdering =
    selected !== undefined &&
    selectedWithoutTierSupply !== undefined &&
    selected.player.id !== selectedWithoutTierSupply.player.id;
  const draftTimingChangedOrdering =
    selected !== undefined &&
    selectedWithoutDraftTiming !== undefined &&
    selected.player.id !== selectedWithoutDraftTiming.player.id;
  const leagueValueChangedOrdering =
    selected !== undefined &&
    selectedWithoutLeagueValue !== undefined &&
    selected.player.id !== selectedWithoutLeagueValue.player.id;
  const rosterFitChangedOrdering =
    selected !== undefined &&
    selectedWithoutRosterFit !== undefined &&
    selected.player.id !== selectedWithoutRosterFit.player.id;
  const feasibilityException =
    selected !== undefined &&
    selected.factors.rosterFit.legalCompletionPossible &&
    !selected.factors.conservativeBoundary.withinBoundary &&
    !evaluations.some((evaluation) =>
      evaluation.factors.conservativeBoundary.withinBoundary &&
      evaluation.factors.rosterFit.legalCompletionPossible
    );
  const evaluationsWithSelection = evaluations.map((evaluation) =>
    evaluation.player.id === selected?.player.id
      ? {
          ...evaluation,
          factors: {
            ...evaluation.factors,
            leagueValue: {
              ...evaluation.factors.leagueValue,
              materiallyChangedOrdering: leagueValueChangedOrdering,
            },
            rosterFit: {
              ...evaluation.factors.rosterFit,
              materiallyChangedOrdering: rosterFitChangedOrdering,
            },
            tierSupply: {
              ...evaluation.factors.tierSupply,
              materiallyChangedOrdering: tierSupplyChangedOrdering,
            },
            draftTiming: {
              ...evaluation.factors.draftTiming,
              materiallyChangedOrdering: draftTimingChangedOrdering,
            },
            conservativeBoundary: {
              ...evaluation.factors.conservativeBoundary,
              feasibilityException,
            },
          },
        }
      : evaluation
  );

  return {
    evaluations: evaluationsWithSelection.sort((left, right) =>
      Number(right.player.id === selected?.player.id) -
        Number(left.player.id === selected?.player.id) ||
      compareEvaluations(left, right)
    ),
    preferredPlayerId: selected?.player.id,
    feasibilityException,
  };
}
