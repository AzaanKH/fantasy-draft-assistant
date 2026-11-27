import { LIVE_DRAFT_DISPLAY, type DraftDisplayContext } from '../display-context.js';
import { toWholePercent } from '../../units/brands.js';
import type { DecisionDivergenceFactor, DecisionLens, DecisionOutput, Recommendation } from '../../draft.js';
import type { RecommendationResult, RecommendationSelection } from '../calculations/recommendations.js';
import { getRecommendationExplanation } from './recommendation-explanation.js';

export interface DraftDecisionView {
  readonly recommendations: readonly Recommendation[];
  readonly preferred: Recommendation | null;
  readonly preferredPlayerId?: string;
  readonly rankByPlayerId: ReadonlyMap<string, number>;
  readonly explanationByPlayerId: ReadonlyMap<string, string>;
  readonly selection: RecommendationSelection;
}

export interface DraftDecisionOutput extends DecisionOutput {
  readonly rankedFitView: DraftDecisionView;
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
  comparisonPolicyVersion: Recommendation | undefined,
  factor: DecisionDivergenceFactor
): number {
  const preferredFactors = preferred.decisionFactors;
  const comparisonFactors = comparisonPolicyVersion?.decisionFactors;
  if (!preferredFactors) return Number.NEGATIVE_INFINITY;

  if (factor === 'league-value') {
    return preferredFactors.leagueValue.score -
      (comparisonFactors?.leagueValue.score ?? 0);
  }
  if (factor === 'roster-fit') {
    return preferredFactors.rosterFit.score -
      (comparisonFactors?.rosterFit.score ?? 0);
  }
  if (factor === 'depth-value') {
    return preferredFactors.depthValue.score -
      (comparisonFactors?.depthValue.score ?? 0);
  }
  if (factor === 'tier-supply') {
    return preferredFactors.tierSupply.score -
      (comparisonFactors?.tierSupply.score ?? 0);
  }
  return preferredFactors.draftTiming.score -
    (comparisonFactors?.draftTiming.score ?? 0);
}

function getDominantDivergenceFactor(
  bestPick: Recommendation,
  comparisonPolicyVersion: Recommendation | undefined
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
        comparisonPolicyVersion,
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
        comparisonPolicyVersion,
        'roster-fit'
      ),
    },
    {
      factor: 'depth-value',
      materiallyChangedOrdering:
        factors.depthValue.materiallyChangedOrdering,
      advantage: getFactorAdvantage(
        bestPick,
        comparisonPolicyVersion,
        'depth-value'
      ),
    },
    {
      factor: 'tier-supply',
      materiallyChangedOrdering: factors.tierSupply.materiallyChangedOrdering,
      advantage: getFactorAdvantage(
        bestPick,
        comparisonPolicyVersion,
        'tier-supply'
      ),
    },
    {
      factor: 'draft-timing',
      materiallyChangedOrdering: factors.draftTiming.materiallyChangedOrdering,
      advantage: getFactorAdvantage(
        bestPick,
        comparisonPolicyVersion,
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
  comparison: Recommendation,
  comparisonPolicyVersion: Recommendation | undefined
): string {
  const factors = bestPick.decisionFactors;
  if (!factors) return 'the bounded completed-roster policy changes the order';

  if (factor === 'league-value') {
    const preferredValue = factors.leagueValue.valueOverReplacement;
    const comparisonValue = comparisonPolicyVersion?.decisionFactors
      ?.leagueValue.valueOverReplacement ??
      comparison.diagnostics?.valueOverReplacement;
    const valueAdvantage = comparisonValue === undefined
      ? null
      : preferredValue - comparisonValue;
    return valueAdvantage !== null && valueAdvantage > 0
      ? `${bestPick.playerName} is ${formatSignedNumber(preferredValue)} pts over a fill-in starter, ${formatNumber(valueAdvantage)} more than ${comparison.playerName} in this league`
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

  if (factor === 'depth-value') {
    const depth = factors.depthValue;
    return `${bestPick.playerName} adds ${bestPick.position} depth with ${pluralize(depth.reserveCount, 'current reserve', 'current reserves')} against a target of ${String(depth.targetReserveCount)}`;
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
  const returnPercent = timing.returnProbability === undefined
    ? null
    : toWholePercent(timing.returnProbability);
  return returnPercent === null
    ? `waiting until pick ${nextPick} costs ${formatNumber(timing.costOfWaiting)} expected points on ${bestPick.playerName}`
    : `${bestPick.playerName} has only a ${String(returnPercent)}% chance of still being there at pick ${nextPick}, and waiting costs ${formatNumber(timing.costOfWaiting)} expected points`;
}

/** Best Pick against Ranked Fit: the policy alternative against the default lens. */
function getDecisionDivergence(
  bestPick: Recommendation | null,
  rankedFit: Recommendation | null,
  bestPickView: DraftDecisionView,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): {
  readonly factor: DecisionDivergenceFactor | null;
  readonly explanation: string | null;
} {
  const { RANKING_LABELS, IS_DEMO } = display;
  if (
    !bestPick ||
    !rankedFit ||
    bestPick.playerId === rankedFit.playerId
  ) {
    return { factor: null, explanation: null };
  }

  const rankedFitPolicyVersion = getPolicyVersion(
    bestPickView,
    rankedFit.playerId
  );
  const factor = getDominantDivergenceFactor(
    bestPick,
    rankedFitPolicyVersion
  );
  if (!factor) return { factor: null, explanation: null };

  const tradeoff = getDivergenceTradeoff(
    factor,
    bestPick,
    rankedFit,
    rankedFitPolicyVersion
  );
  const ecrRank = rankedFit.diagnostics?.expertRank;
  const rankedFitMeaning = ecrRank === undefined
    ? IS_DEMO ? `under the ${RANKING_LABELS.anchor.toLowerCase()}` : 'under the trusted ECR Anchor'
    : `at ${RANKING_LABELS.inline} #${String(ecrRank)}`;

  return {
    factor,
    explanation: `Best Pick prefers ${bestPick.playerName} over ${rankedFit.playerName} because ${tradeoff}, while ${rankedFit.playerName} remains Ranked Fit ${rankedFitMeaning}.`,
  };
}

/** The Decision Lens whose order a view's selection policy produces. */
export function getDecisionLensForPolicy(policy: RecommendationSelection['policy'] | undefined): DecisionLens {
  if (policy === 'ranked-fit') return 'ranked-fit';
  if (policy === 'ecr-anchor') return 'best-player';
  return 'best-pick';
}

export function createDraftDecisionView(
  recommendations: readonly Recommendation[],
  selection: RecommendationSelection,
  fallbackPreferred: Recommendation | null = null,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
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
        getRecommendationExplanation(recommendation, display, getDecisionLensForPolicy(selection.policy)),
      ])
    ),
    selection: {
      ...selection,
      preferredPlayerId: preferred?.playerId,
    },
  };
}

export type DraftDecisionInput = Pick<RecommendationResult, 'draftNow' | 'selection' | 'bestAvailable' | 'rankedFit'>;

export function createDraftDecisionOutput(
  input: DraftDecisionInput,
  selectedLens: DecisionLens,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): DraftDecisionOutput {
  const bestPickView = createDraftDecisionView(
    input.draftNow,
    input.selection, undefined,
    display
  );
  const bestPlayerView = createDraftDecisionView(
    input.bestAvailable,
    {
      preferredPlayerId: input.bestAvailable[0]?.playerId,
      policy: 'ecr-anchor',
    }, undefined,
    display
  );
  const rankedFitView = createDraftDecisionView(
    input.rankedFit,
    {
      preferredPlayerId: input.rankedFit[0]?.playerId,
      policy: 'ranked-fit',
    }, undefined,
    display
  );
  const rankedFit = rankedFitView.preferred;
  const bestPick = bestPickView.preferred;
  const bestPlayer = bestPlayerView.preferred;
  const selectedView = selectedLens === 'best-pick'
    ? bestPickView
    : selectedLens === 'best-player'
      ? bestPlayerView
      : rankedFitView;
  const divergence = getDecisionDivergence(
    bestPick,
    rankedFit,
    bestPickView,
    display
  );

  return {
    rankedFit,
    bestPick,
    bestPlayer,
    selectedLens,
    selected: selectedView.preferred,
    decisionDivergence:
      bestPick !== null &&
      rankedFit !== null &&
      bestPick.playerId !== rankedFit.playerId,
    decisionDivergenceFactor: divergence.factor,
    decisionDivergenceExplanation: divergence.explanation,
    rankedFitView,
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
  selection: RecommendationSelection,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): string {
  const { RANKING_LABELS, LEAGUE_LABEL } = display;
  if (selection.policy === 'roster-feasibility') return 'Roster feasibility';
  if (selection.policy === 'primary-league-policy') return `${LEAGUE_LABEL} policy`;
  if (selection.policy === 'ecr-anchor') return RANKING_LABELS.anchor;
  if (selection.policy === 'ranked-fit') return 'Ranked Fit';
  return 'League-aware score';
}
