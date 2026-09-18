import { type DraftDecisionView } from '@/features/recommendations/draft-decision';
import { formatSignedNumber } from '@/lib/utils';
import { type PositionNeed, type Recommendation } from '@fantasy-draft/shared';


export type PoolSort = 'recommendation' | 'tier';
export type SignalTone = 'positive' | 'caution' | 'urgent' | 'neutral';
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

export function getAssistantPlayerCopy(
  selectedRecommendation: Recommendation,
  preferredRecommendation: Recommendation | null
): {
  readonly analysisHeading: string;
  readonly recommendationStatus: string;
} {
  const isPreferred = selectedRecommendation.playerId === preferredRecommendation?.playerId;

  return {
    analysisHeading: `Analysis for ${selectedRecommendation.playerName}`,
    recommendationStatus: preferredRecommendation
      ? `Recommended for this pick: ${preferredRecommendation.playerName}.${isPreferred
        ? ''
        : ` ${selectedRecommendation.playerName} is being reviewed as an alternative.`}`
      : `No current recommendation. Reviewing ${selectedRecommendation.playerName}.`,
  };
}

export function getSignalSurface(tone: SignalTone): string {
  return {
    positive:
      'border-emerald-500/35 bg-emerald-500/[0.09] dark:border-emerald-500/40 dark:bg-emerald-500/[0.14]',
    caution:
      'border-amber-500/35 bg-amber-500/[0.09] dark:border-amber-500/40 dark:bg-amber-500/[0.14]',
    urgent:
      'border-red-500/35 bg-red-500/[0.09] dark:border-red-500/40 dark:bg-red-500/[0.14]',
    neutral: 'border-border/70 bg-muted/30',
  }[tone];
}

export function getSignalValueColor(tone: SignalTone): string {
  return {
    positive: 'text-emerald-700 dark:text-emerald-300',
    caution: 'text-amber-800 dark:text-amber-300',
    urgent: 'text-red-700 dark:text-red-300',
    neutral: 'text-foreground',
  }[tone];
}

export function getNeedTone(need: PositionNeed | undefined): SignalTone {
  if (need?.priority === 'critical') return 'urgent';
  if (need?.priority === 'high') return 'caution';
  if (need?.priority === 'medium') return 'positive';
  return 'neutral';
}

export function getNeedSlotSummary(need: PositionNeed): string {
  const fixedSummary = `${String(need.startersFilled)} of ${String(need.startersNeeded)} ${need.position} fixed starter slots filled`;
  if (!need.isFlexEligible || need.flexSlotsNeeded === 0) return fixedSummary;
  return `${fixedSummary}; ${String(need.flexSlotsFilled)} of ${String(need.flexSlotsNeeded)} shared FLEX starter slots filled`;
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

export interface AssistantAnswerSection {
  readonly label: 'Why now' | 'Risk of waiting' | 'Best fallback' | 'What changed the recommendation';
  readonly answer: string;
  readonly tone: SignalTone;
}

export function getRecommendationChangeAnswer(
  recommendation: Recommendation,
  isTopPick: boolean,
  positionRank?: number
): string {
  const factors = recommendation.decisionFactors;
  if (!factors) {
    return isTopPick
      ? 'No policy adjustment changed the ECR order. This player remained Best Pick.'
      : `No policy adjustment moved this player to Best Pick${positionRank === undefined
        ? '.'
        : `; this player ranks #${String(positionRank)} at ${recommendation.position}.`}`;
  }

  if (factors.conservativeBoundary.feasibilityException) {
    return 'Roster feasibility changed the order because the normal ECR window could not complete a legal roster.';
  }

  const changedFactors = [
    {
      changed: factors.leagueValue.materiallyChangedOrdering === true,
      score: factors.leagueValue.score,
      answer: `Primary League value changed the order, adding ${factors.leagueValue.score.toFixed(1)} policy points.`,
    },
    {
      changed: factors.rosterFit.materiallyChangedOrdering === true,
      score: factors.rosterFit.score,
      answer: `Roster fit changed the order with ${String(factors.rosterFit.fixedStartersOpen)} fixed starter spots and ${String(factors.rosterFit.flexSlotsOpen)} FLEX spots open.`,
    },
    {
      changed: factors.depthValue.materiallyChangedOrdering,
      score: factors.depthValue.score,
      answer: `Depth Value changed the order because the roster has ${String(factors.depthValue.reserveCount)} ${recommendation.position} reserves against a target of ${String(factors.depthValue.targetReserveCount)}.`,
    },
    {
      changed: factors.tierSupply.materiallyChangedOrdering,
      score: factors.tierSupply.score,
      answer: `Tier supply changed the order. Only ${String(factors.tierSupply.remainingInTier)} ${recommendation.position}${factors.tierSupply.remainingInTier === 1 ? '' : 's'} remain in Tier ${String(factors.tierSupply.currentTier)} before a ${factors.tierSupply.dropoffPoints.toFixed(1)} point drop.`,
    },
    {
      changed: factors.draftTiming.materiallyChangedOrdering,
      score: factors.draftTiming.score,
      answer: `Draft timing changed the order because waiting costs ${factors.draftTiming.costOfWaiting.toFixed(1)} expected points.`,
    },
  ]
    .filter((factor) => factor.changed)
    .sort((first, second) => second.score - first.score);

  return changedFactors[0]?.answer ?? (isTopPick
    ? 'No bounded adjustment changed the ECR order. The policy confirmed this player as Best Pick.'
    : `The bounded adjustments did not move this player to Best Pick${positionRank === undefined
      ? '.'
      : `; this player ranks #${String(positionRank)} at ${recommendation.position}.`}`);
}

export function getAssistantAnswerSections(
  recommendation: Recommendation,
  isTopPick: boolean,
  positionRank?: number
): readonly AssistantAnswerSection[] {
  const diagnostics = recommendation.diagnostics;
  const factors = recommendation.decisionFactors;
  const returnProbability = factors?.draftTiming.returnProbability
    ?? diagnostics?.nextPickSurvivalProbability;
  const returnPercent = returnProbability === undefined
    ? null
    : Math.round(returnProbability * 100);
  const nextPickLabel = factors?.draftTiming.nextPickLabel
    ?? diagnostics?.nextPickLabel
    ?? 'your next pick';
  const nextPickReference = nextPickLabel === 'your next pick'
    ? nextPickLabel
    : `pick ${nextPickLabel}`;
  const costOfWaiting = factors?.draftTiming.costOfWaiting
    ?? diagnostics?.nextPickCostOfWaiting;
  const fallback = factors?.draftTiming.expectedAlternative
    ?? diagnostics?.expectedNextPickAlternative;

  let whyNow: string;
  if (!isTopPick && positionRank !== undefined) {
    whyNow = diagnostics
      ? `${recommendation.playerName} ranks #${String(positionRank)} among available ${recommendation.position}s, with ${formatSignedNumber(diagnostics.valueOverReplacement, 0)} projected points above replacement.`
      : `${recommendation.playerName} ranks #${String(positionRank)} among available ${recommendation.position}s.`;
  } else if (factors?.tierSupply.materiallyChangedOrdering) {
    whyNow = `Only ${String(factors.tierSupply.remainingInTier)} ${recommendation.position}${factors.tierSupply.remainingInTier === 1 ? '' : 's'} remain in Tier ${String(factors.tierSupply.currentTier)}, then projected value drops ${factors.tierSupply.dropoffPoints.toFixed(1)} points.`;
  } else if (factors?.draftTiming.materiallyChangedOrdering) {
    whyNow = `Waiting costs ${factors.draftTiming.costOfWaiting.toFixed(1)} expected points on ${recommendation.playerName}.`;
  } else if (diagnostics?.isLastInTier) {
    whyNow = `${recommendation.playerName} is the last available ${recommendation.position} in Tier ${String(diagnostics.tier)}.`;
  } else if (diagnostics) {
    whyNow = `${recommendation.playerName} is ECR #${String(diagnostics.expertRank)} and projects ${formatSignedNumber(diagnostics.valueOverReplacement, 0)} points above replacement.`;
  } else {
    whyNow = `${recommendation.playerName} leads this decision because ${recommendation.reason.toLowerCase()}.`;
  }

  const riskOfWaiting = returnPercent === null
    ? 'Return Probability is still being calculated.'
    : `${returnPercent < 35 ? 'Only ' : ''}${String(returnPercent)}% Return Probability at ${nextPickReference}.${costOfWaiting !== undefined && costOfWaiting > 0
      ? ` Waiting costs ${costOfWaiting.toFixed(1)} expected points.`
      : returnPercent < 70
        ? ' Waiting carries real risk.'
        : ' Waiting is reasonable if another position matters more.'}`;

  const bestFallback = fallback
    ? `${fallback.playerName} is the Expected Next-Pick Alternative at ${formatSignedNumber(fallback.expectedValue, 0)} expected points above replacement.`
    : 'No same-position fallback is projected at your next pick.';

  return [
    {
      label: 'Why now',
      answer: whyNow,
      tone: isTopPick ? 'positive' : 'neutral',
    },
    {
      label: 'Risk of waiting',
      answer: riskOfWaiting,
      tone: returnPercent === null
        ? 'neutral'
        : returnPercent < 35
          ? 'urgent'
          : returnPercent < 70
            ? 'caution'
            : 'positive',
    },
    {
      label: 'Best fallback',
      answer: bestFallback,
      tone: fallback ? 'neutral' : 'caution',
    },
    {
      label: 'What changed the recommendation',
      answer: getRecommendationChangeAnswer(recommendation, isTopPick, positionRank),
      tone: 'neutral',
    },
  ];
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
        detail: `${leader.playerName} has ${difference.toFixed(0)} more projected points above replacement.`,
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
