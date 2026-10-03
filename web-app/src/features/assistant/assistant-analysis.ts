import { type DraftDecisionView } from '@/features/recommendations/draft-decision';
import { formatSignedNumber } from '@/lib/utils';
import { type ExpectedNextPickAlternative, type Recommendation } from '@fantasy-draft/shared';


export type PoolSort = 'recommendation' | 'tier';
export type SignalTone = 'positive' | 'caution' | 'urgent' | 'neutral';

function pluralize(value: number, singular: string, plural: string): string {
  return `${String(value)} ${value === 1 ? singular : plural}`;
}
export function survivalPercent(recommendation: Recommendation): number | null {
  const probability = recommendation.diagnostics?.nextPickSurvivalProbability;
  return typeof probability === 'number' ? Math.round(probability * 100) : null;
}

export function sortRecommendationsForPool(
  recommendations: readonly Recommendation[],
  sort: PoolSort
): readonly Recommendation[] {
  if (sort === 'recommendation') return recommendations;

  return recommendations
    .map((recommendation, modelIndex) => ({ recommendation, modelIndex }))
    .sort((first, second) => {
      const tierDifference = (first.recommendation.diagnostics?.tier ?? Number.POSITIVE_INFINITY)
        - (second.recommendation.diagnostics?.tier ?? Number.POSITIVE_INFINITY);
      return tierDifference !== 0 ? tierDifference : first.modelIndex - second.modelIndex;
    })
    .map(({ recommendation }) => recommendation);
}

/** Text tone from the design-system state colors; meaning is always carried by the words too. */
export function getSignalValueColor(tone: SignalTone): string {
  return {
    positive: 'text-[color:var(--color-success)]',
    caution: 'text-[color:var(--color-warning)]',
    urgent: 'text-[color:var(--color-danger)]',
    neutral: 'text-foreground',
  }[tone];
}

export function getAvailabilitySignal(survival: number | null): {
  readonly status: string;
  readonly tone: SignalTone;
} {
  if (survival === null) return { status: 'Still calculating', tone: 'neutral' };
  if (survival < 35) return { status: 'Unlikely to make it back', tone: 'urgent' };
  if (survival < 70) return { status: 'Risky to wait', tone: 'caution' };
  return { status: 'Likely available later', tone: 'positive' };
}

export interface AssistantAnswerRow {
  readonly label: string;
  readonly answer: string;
  readonly tone: SignalTone;
}

interface TimingFacts {
  readonly returnPercent: number | null;
  readonly nextPickReference: string;
  readonly costOfWaiting: number | undefined;
  readonly fallback: ExpectedNextPickAlternative | undefined;
}

function getTimingFacts(recommendation: Recommendation): TimingFacts {
  const diagnostics = recommendation.diagnostics;
  const factors = recommendation.decisionFactors;
  const returnProbability = factors?.draftTiming.returnProbability
    ?? diagnostics?.nextPickSurvivalProbability;
  const nextPickLabel = factors?.draftTiming.nextPickLabel ?? diagnostics?.nextPickLabel;
  return {
    returnPercent: returnProbability === undefined ? null : Math.round(returnProbability * 100),
    nextPickReference: nextPickLabel ? `pick ${nextPickLabel}` : 'your next pick',
    costOfWaiting: factors?.draftTiming.costOfWaiting ?? diagnostics?.nextPickCostOfWaiting,
    fallback: factors?.draftTiming.expectedAlternative ?? diagnostics?.expectedNextPickAlternative,
  };
}

/** States which bounded adjustment moved the order, without restating figures owned by other answers. */
export function getRecommendationChangeAnswer(
  recommendation: Recommendation,
  isTopPick: boolean,
  positionRank?: number
): string {
  const factors = recommendation.decisionFactors;
  const unchanged = isTopPick
    ? 'No bounded adjustment changed the ECR order. The policy confirmed this player as Best Pick.'
    : `The bounded adjustments did not move this player to Best Pick${positionRank === undefined
      ? '.'
      : `; this player ranks #${String(positionRank)} at ${recommendation.position}.`}`;
  if (!factors) return unchanged;

  if (factors.conservativeBoundary.feasibilityException) {
    return 'Roster feasibility changed the order because the normal ECR window could not complete a legal roster.';
  }

  const changedFactors = [
    { changed: factors.leagueValue.materiallyChangedOrdering === true, score: factors.leagueValue.score, answer: 'Primary League value changed the order.' },
    { changed: factors.rosterFit.materiallyChangedOrdering === true, score: factors.rosterFit.score, answer: 'Roster fit changed the order.' },
    { changed: factors.depthValue.materiallyChangedOrdering, score: factors.depthValue.score, answer: `Depth Value changed the order: ${String(factors.depthValue.reserveCount)} ${recommendation.position} reserves against a target of ${String(factors.depthValue.targetReserveCount)}.` },
    { changed: factors.tierSupply.materiallyChangedOrdering, score: factors.tierSupply.score, answer: 'Tier supply changed the order.' },
    { changed: factors.draftTiming.materiallyChangedOrdering, score: factors.draftTiming.score, answer: 'Draft timing changed the order. Can I wait? shows the cost.' },
  ]
    .filter((factor) => factor.changed)
    .sort((first, second) => second.score - first.score);

  return changedFactors[0]?.answer ?? unchanged;
}

/** Why this player? owns value, roster fit and tier. Timing belongs to Can I wait?. */
export function getWhyRows(
  recommendation: Recommendation,
  isTopPick: boolean,
  positionRank?: number
): readonly AssistantAnswerRow[] {
  const diagnostics = recommendation.diagnostics;
  const factors = recommendation.decisionFactors;
  const positionPlace = positionRank === undefined
    ? ''
    : ` #${String(positionRank)} among available ${recommendation.position}s.`;
  const value = diagnostics
    ? `VOR ${formatSignedNumber(diagnostics.valueOverReplacement, 0)}. ECR #${String(diagnostics.expertRank)}.${positionPlace}`
    : 'League value is not available for this player.';
  const rosterFit = factors
    ? `${pluralize(factors.rosterFit.fixedStartersOpen, 'starter spot', 'starter spots')} and ${pluralize(factors.rosterFit.flexSlotsOpen, 'FLEX spot', 'FLEX spots')} open, ${pluralize(factors.rosterFit.selectionsRemaining, 'selection', 'selections')} left.`
    : 'Roster fit is not available for this player.';
  const tierSupply = factors?.tierSupply;
  const tier = tierSupply
    ? `Tier ${String(tierSupply.currentTier)} · ${String(tierSupply.remainingInTier)} left${tierSupply.dropoffPoints > 0 ? ` before a ${tierSupply.dropoffPoints.toFixed(1)} point drop` : ''}.`
    : diagnostics
      ? `Tier ${String(diagnostics.tier)}${diagnostics.isLastInTier ? ' · last in tier' : ''}.`
      : 'Tier is not available for this player.';

  return [
    { label: 'Value', answer: value, tone: isTopPick ? 'positive' : 'neutral' },
    { label: 'Roster fit', answer: rosterFit, tone: 'neutral' },
    { label: 'Tier', answer: tier, tone: tierSupply && tierSupply.remainingInTier <= 2 ? 'caution' : 'neutral' },
    { label: 'Why it ranks here', answer: getRecommendationChangeAnswer(recommendation, isTopPick, positionRank), tone: 'neutral' },
  ];
}

/** Can I wait? owns Return Probability, waiting cost and the Expected Next-Pick Alternative. */
export function getWaitAnswer(recommendation: Recommendation): {
  readonly headline: string;
  readonly rows: readonly AssistantAnswerRow[];
} {
  const timing = getTimingFacts(recommendation);
  const signal = getAvailabilitySignal(timing.returnPercent);
  const headline = timing.returnPercent === null
    ? 'Waiting risk is unavailable.'
    : timing.returnPercent < 35
      ? `Unlikely to return at ${timing.nextPickReference}.`
      : timing.returnPercent < 70
        ? `Could return at ${timing.nextPickReference}.`
        : `Likely to return at ${timing.nextPickReference}.`;

  return {
    headline,
    rows: [
      {
        label: 'At next pick',
        answer: timing.returnPercent === null
          ? 'Unavailable. Timing inputs are missing.'
          : `${String(timing.returnPercent)}% Return Probability`,
        tone: signal.tone,
      },
      {
        label: 'Waiting cost',
        answer: timing.returnPercent === null || timing.costOfWaiting === undefined
          ? 'Unavailable'
          : `${timing.costOfWaiting.toFixed(1)} expected points`,
        tone: 'neutral',
      },
      {
        label: 'Expected Next-Pick Alternative',
        answer: timing.fallback
          ? `${timing.fallback.playerName}, ${formatSignedNumber(timing.fallback.expectedValue, 0)} expected points above replacement`
          : 'No same-position fallback is projected.',
        tone: timing.fallback ? 'neutral' : 'caution',
      },
    ],
  };
}

/** The lead metric on the preferred card: what waiting until the next pick costs, and the fallback. */
export function getWaitingCostSummary(recommendation: Recommendation): {
  readonly costOfWaiting: number | null;
  readonly nextPickLabel: string | null;
  readonly fallbackName: string | null;
  readonly fallbackValue: number | null;
} {
  const timing = getTimingFacts(recommendation);
  return {
    costOfWaiting: timing.returnPercent === null ? null : timing.costOfWaiting ?? null,
    nextPickLabel: recommendation.decisionFactors?.draftTiming.nextPickLabel
      ?? recommendation.diagnostics?.nextPickLabel
      ?? null,
    fallbackName: timing.fallback?.playerName ?? null,
    fallbackValue: timing.fallback?.expectedValue ?? null,
  };
}

export interface ComparisonHighlight {
  readonly label: string;
  readonly detail: string;
}

export function getComparisonHighlights(
  first: Recommendation,
  second: Recommendation,
  decision: DraftDecisionView
): readonly ComparisonHighlight[] {
  const highlights: ComparisonHighlight[] = [];
  const firstValue = first.diagnostics?.valueOverReplacement;
  const secondValue = second.diagnostics?.valueOverReplacement;
  if (firstValue !== undefined && secondValue !== undefined) {
    const difference = Math.abs(firstValue - secondValue);
    if (difference >= 1) {
      const leader = firstValue > secondValue ? first : second;
      highlights.push({
        label: 'League value',
        detail: `${leader.playerName} has ${String(Number(difference.toFixed(1)))} more projected points above replacement.`,
      });
    }
  }

  const firstSurvival = survivalPercent(first);
  const secondSurvival = survivalPercent(second);
  if (firstSurvival !== null && secondSurvival !== null) {
    const difference = Math.abs(firstSurvival - secondSurvival);
    if (difference >= 5) {
      const lessLikely = firstSurvival < secondSurvival ? first : second;
      highlights.push({
        label: 'Wait risk',
        detail: `${lessLikely.playerName} is ${String(difference)} percentage points less likely to reach your next pick.`,
      });
    }
  }

  const firstTier = first.diagnostics?.tier;
  const secondTier = second.diagnostics?.tier;
  if (
    first.position === second.position &&
    firstTier !== undefined &&
    secondTier !== undefined &&
    firstTier !== secondTier
  ) {
    const higherTier = firstTier < secondTier ? first : second;
    highlights.push({
      label: 'Position tier',
      detail: `${higherTier.playerName} sits ${String(Math.abs(firstTier - secondTier))} tier${Math.abs(firstTier - secondTier) === 1 ? '' : 's'} higher at ${first.position}.`,
    });
  }

  const firstEcr = first.diagnostics?.expertRank;
  const secondEcr = second.diagnostics?.expertRank;
  if (firstEcr !== undefined && secondEcr !== undefined && firstEcr !== secondEcr) {
    const leader = firstEcr < secondEcr ? first : second;
    const leaderRank = Math.min(firstEcr, secondEcr);
    const difference = Math.abs(firstEcr - secondEcr);
    highlights.push({
      label: 'Player quality',
      detail: `${leader.playerName} is ECR #${String(leaderRank)}, ${String(difference)} place${difference === 1 ? '' : 's'} ahead.`,
    });
  }

  const firstRank = decision.rankByPlayerId.get(first.playerId);
  const secondRank = decision.rankByPlayerId.get(second.playerId);
  if (
    highlights.length === 0 &&
    firstRank !== undefined &&
    secondRank !== undefined &&
    firstRank !== secondRank
  ) {
    const leader = firstRank < secondRank ? first : second;
    highlights.push({
      label: 'Pick order',
      detail: `${leader.playerName} ranks ${String(Math.abs(firstRank - secondRank))} place${Math.abs(firstRank - secondRank) === 1 ? '' : 's'} higher for this pick.`,
    });
  }

  return highlights.slice(0, 3);
}
