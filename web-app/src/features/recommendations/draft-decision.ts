import type {
  DecisionDivergenceFactor,
  DecisionLens,
  DecisionOutput,
  Recommendation,
} from '@fantasy-draft/shared';
import type { RecommendationSelection } from '@/lib/calculations';
import { getRecommendationExplanation } from './recommendation-explanation';

export interface DraftDecisionView {
  readonly recommendations: readonly Recommendation[];
  readonly preferred: Recommendation | null;
  readonly preferredPlayerId?: string;
  readonly rankByPlayerId: ReadonlyMap<string, number>;
  readonly explanationByPlayerId: ReadonlyMap<string, string>;
  readonly selection: RecommendationSelection;
}

export interface DraftDecisionOutput extends DecisionOutput {
  readonly bestPickView: DraftDecisionView;
  readonly bestPlayerView: DraftDecisionView;
  readonly selectedView: DraftDecisionView;
}

interface DivergenceFactorCandidate {
  readonly factor: DecisionDivergenceFactor;
  readonly materiallyChangedOrdering: boolean;
  readonly advantage: number;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(1)));
}

function formatSignedNumber(value: number): string {
  const rounded = Number(value.toFixed(1));
  return `${rounded >= 0 ? '+' : ''}${String(rounded)}`;
}

function pluralize(value: number, singular: string, plural: string): string {
  return `${String(value)} ${value === 1 ? singular : plural}`;
}

function getPolicyVersion(
  view: DraftDecisionView,
  playerId: string
): Recommendation | undefined {
  return view.recommendations.find(
    (recommendation) => recommendation.playerId === playerId
  );
}

function getFactorAdvantage(
  preferred: Recommendation,
  bestPlayerPolicyVersion: Recommendation | undefined,
  factor: DecisionDivergenceFactor
): number {
  const preferredFactors = preferred.decisionFactors;
  const bestPlayerFactors = bestPlayerPolicyVersion?.decisionFactors;
  if (!preferredFactors) return Number.NEGATIVE_INFINITY;

  if (factor === 'league-value') {
    return preferredFactors.leagueValue.score -
      (bestPlayerFactors?.leagueValue.score ?? 0);
  }
  if (factor === 'roster-fit') {
    return preferredFactors.rosterFit.score -
      (bestPlayerFactors?.rosterFit.score ?? 0);
  }
  if (factor === 'tier-supply') {
    return preferredFactors.tierSupply.score -
      (bestPlayerFactors?.tierSupply.score ?? 0);
  }
  return preferredFactors.draftTiming.score -
    (bestPlayerFactors?.draftTiming.score ?? 0);
}

function getDominantDivergenceFactor(
  bestPick: Recommendation,
  bestPlayerPolicyVersion: Recommendation | undefined
): DecisionDivergenceFactor | null {
  const factors = bestPick.decisionFactors;
  if (!factors) return null;

  const candidates: readonly DivergenceFactorCandidate[] = [
    {
      factor: 'league-value',
      materiallyChangedOrdering:
        factors.leagueValue.materiallyChangedOrdering === true,
      advantage: getFactorAdvantage(
        bestPick,
        bestPlayerPolicyVersion,
        'league-value'
      ),
    },
    {
      factor: 'roster-fit',
      materiallyChangedOrdering:
        factors.rosterFit.materiallyChangedOrdering === true ||
        factors.conservativeBoundary.feasibilityException,
      advantage: getFactorAdvantage(
        bestPick,
        bestPlayerPolicyVersion,
        'roster-fit'
      ),
    },
    {
      factor: 'tier-supply',
      materiallyChangedOrdering: factors.tierSupply.materiallyChangedOrdering,
      advantage: getFactorAdvantage(
        bestPick,
        bestPlayerPolicyVersion,
        'tier-supply'
      ),
    },
    {
      factor: 'draft-timing',
      materiallyChangedOrdering: factors.draftTiming.materiallyChangedOrdering,
      advantage: getFactorAdvantage(
        bestPick,
        bestPlayerPolicyVersion,
        'draft-timing'
      ),
    },
  ];
  const causalCandidates = candidates.filter(
    (candidate) => candidate.materiallyChangedOrdering
  );
  const eligibleCandidates = causalCandidates.length > 0
    ? causalCandidates
    : candidates.filter((candidate) => candidate.advantage > 0);

  return [...eligibleCandidates].sort(
    (left, right) => right.advantage - left.advantage
  )[0]?.factor ?? null;
}

function getDivergenceTradeoff(
  factor: DecisionDivergenceFactor,
  bestPick: Recommendation,
  bestPlayer: Recommendation,
  bestPlayerPolicyVersion: Recommendation | undefined
): string {
  const factors = bestPick.decisionFactors;
  if (!factors) return 'the bounded completed-roster policy changes the order';

  if (factor === 'league-value') {
    const preferredValue = factors.leagueValue.valueOverReplacement;
    const bestPlayerValue = bestPlayerPolicyVersion?.decisionFactors
      ?.leagueValue.valueOverReplacement ??
      bestPlayer.diagnostics?.valueOverReplacement;
    const valueAdvantage = bestPlayerValue === undefined
      ? null
      : preferredValue - bestPlayerValue;
    return valueAdvantage !== null && valueAdvantage > 0
      ? `${bestPick.playerName} is ${formatSignedNumber(preferredValue)} points above replacement, ${formatNumber(valueAdvantage)} more than ${bestPlayer.playerName} in this league`
      : `${bestPick.playerName} has the stronger league-adjusted value`;
  }

  if (factor === 'roster-fit') {
    if (factors.conservativeBoundary.feasibilityException) {
      return `${bestPick.playerName} keeps a legal roster possible with only ${pluralize(factors.rosterFit.selectionsRemaining, 'selection', 'selections')} left`;
    }
    const openStarterSpots =
      factors.rosterFit.fixedStartersOpen + factors.rosterFit.flexSlotsOpen;
    return `${bestPick.playerName}'s ${bestPick.position} roster fit matters with ${pluralize(openStarterSpots, 'starting spot', 'starting spots')} open and ${pluralize(factors.rosterFit.selectionsRemaining, 'selection', 'selections')} left`;
  }

  if (factor === 'tier-supply') {
    const tier = factors.tierSupply;
    return `only ${pluralize(tier.remainingInTier, `${bestPick.position} remains`, `${bestPick.position}s remain`)} in Tier ${String(tier.currentTier)} before a ${formatNumber(tier.dropoffPoints)} point drop`;
  }

  const timing = factors.draftTiming;
  const nextPick = timing.nextPickLabel ??
    (timing.nextPickNumber === undefined
      ? 'the next selection'
      : `#${String(timing.nextPickNumber)}`);
  const returnProbability = timing.returnProbability === undefined
    ? null
    : Math.round(timing.returnProbability * 100);
  return returnProbability === null
    ? `waiting until pick ${nextPick} costs ${formatNumber(timing.costOfWaiting)} expected points on ${bestPick.playerName}`
    : `${bestPick.playerName} has only ${String(returnProbability)}% Return Probability at pick ${nextPick}, and waiting costs ${formatNumber(timing.costOfWaiting)} expected points`;
}

function getDecisionDivergence(
  bestPick: Recommendation | null,
  bestPlayer: Recommendation | null,
  bestPickView: DraftDecisionView
): {
  readonly factor: DecisionDivergenceFactor | null;
  readonly explanation: string | null;
} {
  if (
    !bestPick ||
    !bestPlayer ||
    bestPick.playerId === bestPlayer.playerId
  ) {
    return { factor: null, explanation: null };
  }

  const bestPlayerPolicyVersion = getPolicyVersion(
    bestPickView,
    bestPlayer.playerId
  );
  const factor = getDominantDivergenceFactor(
    bestPick,
    bestPlayerPolicyVersion
  );
  if (!factor) return { factor: null, explanation: null };

  const tradeoff = getDivergenceTradeoff(
    factor,
    bestPick,
    bestPlayer,
    bestPlayerPolicyVersion
  );
  const ecrRank = bestPlayer.diagnostics?.expertRank;
  const bestPlayerMeaning = ecrRank === undefined
    ? 'under the trusted ECR Anchor'
    : `at ECR #${String(ecrRank)}`;

  return {
    factor,
    explanation: `Prefer ${bestPick.playerName} over ${bestPlayer.playerName} because ${tradeoff}, while ${bestPlayer.playerName} remains Best Player ${bestPlayerMeaning}.`,
  };
}

export function createDraftDecisionView(
  recommendations: readonly Recommendation[],
  selection: RecommendationSelection,
  fallbackPreferred: Recommendation | null = null
): DraftDecisionView {
  const preferred = recommendations.find(
    (recommendation) => recommendation.playerId === selection.preferredPlayerId
  ) ?? recommendations[0] ?? fallbackPreferred;
  const visibleRecommendations = recommendations.length > 0
    ? recommendations
    : preferred
      ? [preferred]
      : [];

  return {
    recommendations: visibleRecommendations,
    preferred,
    preferredPlayerId: preferred?.playerId,
    rankByPlayerId: new Map(
      visibleRecommendations.map((recommendation, index) => [recommendation.playerId, index + 1])
    ),
    explanationByPlayerId: new Map(
      visibleRecommendations.map((recommendation) => [
        recommendation.playerId,
        getRecommendationExplanation(recommendation),
      ])
    ),
    selection: {
      ...selection,
      preferredPlayerId: preferred?.playerId,
    },
  };
}

export function createDraftDecisionOutput(
  bestPickRecommendations: readonly Recommendation[],
  bestPickSelection: RecommendationSelection,
  bestPlayerRecommendations: readonly Recommendation[],
  selectedLens: DecisionLens
): DraftDecisionOutput {
  const bestPickView = createDraftDecisionView(
    bestPickRecommendations,
    bestPickSelection
  );
  const bestPlayerView = createDraftDecisionView(
    bestPlayerRecommendations,
    {
      preferredPlayerId: bestPlayerRecommendations[0]?.playerId,
      policy: 'ecr-anchor',
    }
  );
  const bestPick = bestPickView.preferred;
  const bestPlayer = bestPlayerView.preferred;
  const selectedView = selectedLens === 'best-pick'
    ? bestPickView
    : bestPlayerView;
  const divergence = getDecisionDivergence(
    bestPick,
    bestPlayer,
    bestPickView
  );

  return {
    bestPick,
    bestPlayer,
    selectedLens,
    selected: selectedView.preferred,
    decisionDivergence:
      bestPick !== null &&
      bestPlayer !== null &&
      bestPick.playerId !== bestPlayer.playerId,
    decisionDivergenceFactor: divergence.factor,
    decisionDivergenceExplanation: divergence.explanation,
    bestPickView,
    bestPlayerView,
    selectedView,
  };
}

export function getPreferredRecommendation(
  decision: DraftDecisionView,
  candidates: readonly Recommendation[]
): Recommendation | null {
  let preferred: Recommendation | null = null;
  let preferredRank = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate) => {
    const rank = decision.rankByPlayerId.get(candidate.playerId) ?? Number.POSITIVE_INFINITY;
    if (preferred === null || rank < preferredRank) {
      preferred = candidate;
      preferredRank = rank;
    }
  });

  return preferred;
}

export function getRecommendationPolicyLabel(
  selection: RecommendationSelection
): string {
  if (selection.policy === 'roster-feasibility') return 'Roster feasibility';
  if (selection.policy === 'primary-league-policy') return 'Primary League policy';
  if (selection.policy === 'pick-ev-override') return 'PickEV override';
  if (selection.policy === 'ecr-anchor') return 'ECR anchor';
  return 'League-aware score';
}
