import { LIVE_DRAFT_DISPLAY, type DraftDisplayContext } from '../display-context.js';
import { toWholePercent, type Percent } from '../../units/brands.js';
import { type DraftDecisionView } from '../recommendations/draft-decision.js';
import { formatSignedNumber } from '../format.js';
import { type ExpectedNextPickAlternative, type PositionNeed, type Recommendation } from '../../draft.js';
import { type Position } from '../../player.js';

export type PoolSort = 'recommendation' | 'tier';
type SignalTone = 'positive' | 'caution' | 'urgent' | 'neutral';

function pluralize(value: number, singular: string, plural: string): string {
  return `${String(value)} ${value === 1 ? singular : plural}`;
}
/** Points over a fill-in starter below this read as "0 pts", which looks like a model error without its reason. */
export const NEAR_ZERO_VALUE_POINTS = 1;

/** True when the player projects about the same as a fill-in starter at his position (either side of zero). */
export function hasNearZeroValue(recommendation: Pick<Recommendation, 'diagnostics'>): boolean {
  const value = recommendation.diagnostics?.valueOverReplacement;
  return typeof value === 'number' && Math.abs(value) < NEAR_ZERO_VALUE_POINTS;
}

export function survivalPercent(recommendation: Recommendation): Percent | null {
  const probability = recommendation.diagnostics?.nextPickSurvivalProbability;
  return typeof probability === 'number' ? toWholePercent(probability) : null;
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

export function getAvailabilitySignal(survival: Percent | null): {
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
  readonly returnPercent: Percent | null;
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
    returnPercent: returnProbability === undefined ? null : toWholePercent(returnProbability),
    nextPickReference: nextPickLabel ? `pick ${nextPickLabel}` : 'your next pick',
    costOfWaiting: factors?.draftTiming.costOfWaiting ?? diagnostics?.nextPickCostOfWaiting,
    fallback: factors?.draftTiming.expectedAlternative ?? diagnostics?.expectedNextPickAlternative,
  };
}

/** States which bounded adjustment moved the order, without restating figures owned by other answers. */
function getRecommendationChangeAnswer(
  recommendation: Recommendation,
  isTopPick: boolean,
  positionRank?: number,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): string {
  const { LEAGUE_LABEL } = display;
  const factors = recommendation.decisionFactors;
  const unchanged = isTopPick
    ? 'Follows the rankings; roster and timing did not move anyone ahead.'
    : `Roster and timing did not lift this player above the Best Pick${positionRank === undefined
      ? '.'
      : `; #${String(positionRank)} at ${recommendation.position}.`}`;
  if (!factors) return unchanged;

  if (factors.conservativeBoundary.feasibilityException) {
    return 'Taken early so your roster can still be filled; the usual range of the rankings could not fill it.';
  }

  const changedFactors = [
    { changed: factors.leagueValue.materiallyChangedOrdering === true, score: factors.leagueValue.score, answer: `${LEAGUE_LABEL} scoring moved this player up.` },
    { changed: factors.rosterFit.materiallyChangedOrdering === true, score: factors.rosterFit.score, answer: 'Your open roster spots moved this player up.' },
    { changed: factors.depthValue.materiallyChangedOrdering, score: factors.depthValue.score, answer: `Depth moved this player up: ${String(factors.depthValue.reserveCount)} of ${String(factors.depthValue.targetReserveCount)} backup ${recommendation.position}s.` },
    { changed: factors.tierSupply.materiallyChangedOrdering, score: factors.tierSupply.score, answer: 'A thinning tier moved this player up.' },
    { changed: factors.draftTiming.materiallyChangedOrdering, score: factors.draftTiming.score, answer: 'The cost of waiting moved this player up.' },
  ]
    .filter((factor) => factor.changed)
    .sort((first, second) => second.score - first.score);

  return changedFactors[0]?.answer ?? unchanged;
}

/** Why this player? owns value, roster fit and tier. Timing belongs to Can I wait?. */
export function getWhyRows(
  recommendation: Recommendation,
  isTopPick: boolean,
  positionRank?: number,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): readonly AssistantAnswerRow[] {
  const diagnostics = recommendation.diagnostics;
  const factors = recommendation.decisionFactors;
  const positionPlace = positionRank === undefined
    ? ''
    : ` #${String(positionRank)} among available ${recommendation.position}s.`;
  // Plain words on the primary line; the detailed figures stay in Full reasoning.
  const vor = diagnostics ? Math.round(diagnostics.valueOverReplacement) : 0;
  // "Projects 0 pts more than a fill-in DEF" reads as a model error: say it plainly and let the rows below give
  // the reason (the open spot, the tier, or the order).
  const value = diagnostics
    ? `${hasNearZeroValue(recommendation)
      ? `Projects about the same as a fill-in ${recommendation.position}, so the roster and tier below decide.`
      : `Projects ${pluralize(Math.abs(vor), 'pt', 'pts')} ${vor >= 0 ? 'more' : 'fewer'} than a fill-in ${recommendation.position}.`} #${String(diagnostics.expertRank)} overall.${positionPlace}`
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
    { label: 'Why it ranks here', answer: getRecommendationChangeAnswer(recommendation, isTopPick, positionRank, display), tone: 'neutral' },
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
          : `${String(timing.returnPercent)}% chance he's still there`,
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
          ? `${timing.fallback.playerName}, ${formatSignedNumber(timing.fallback.expectedValue, 0)} expected pts over a fill-in starter`
          : 'No same-position fallback is projected.',
        tone: timing.fallback ? 'neutral' : 'caution',
      },
    ],
  };
}

/**
 * What does my roster need? for one position. A FLEX-eligible player fills an open FLEX starter
 * slot once the position's fixed starters are filled; only then does the pick add depth.
 */
export function getRosterAnswer(needs: readonly PositionNeed[], position: Position): {
  readonly headline: string;
  readonly openStarters: string;
  readonly slots: string;
} {
  const selectedNeed = needs.find((need) => need.position === position);
  const fixedOpen = needs
    .filter((need) => need.startersFilled < need.startersNeeded && need.position !== 'K' && need.position !== 'DEF')
    .map((need) => {
      const open = need.startersNeeded - need.startersFilled;
      return open > 1 ? `${need.position} ×${String(open)}` : need.position;
    });
  const flexNeed = needs.find((need) => need.isFlexEligible);
  const flexOpen = flexNeed ? Math.max(0, flexNeed.flexSlotsNeeded - flexNeed.flexSlotsFilled) : 0;
  const open = flexOpen > 0 ? [...fixedOpen, flexOpen > 1 ? `FLEX ×${String(flexOpen)}` : 'FLEX'] : fixedOpen;
  const hasFlex = selectedNeed?.isFlexEligible === true && selectedNeed.flexSlotsNeeded > 0;

  const headline = !selectedNeed
    ? `Roster context for ${position} is unavailable.`
    : selectedNeed.startersFilled < selectedNeed.startersNeeded
      ? `Fills an open ${position} starter slot.`
      : hasFlex && selectedNeed.flexSlotsFilled < selectedNeed.flexSlotsNeeded
        ? 'Fills an open FLEX starter slot.'
        : `${position}${hasFlex ? ' and FLEX' : ''} starters are filled. This adds depth.`;
  const slots = !selectedNeed
    ? 'Roster context is unavailable.'
    : [
        `${String(selectedNeed.startersFilled)} of ${String(selectedNeed.startersNeeded)} filled`,
        ...(hasFlex ? [`FLEX ${String(selectedNeed.flexSlotsFilled)} of ${String(selectedNeed.flexSlotsNeeded)} filled`] : []),
        `${selectedNeed.priority} need`,
      ].join(' · ');

  return {
    headline,
    openStarters: open.length > 0 ? open.join(', ') : 'All starter slots are filled.',
    slots,
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

interface ComparisonHighlight {
  readonly label: string;
  readonly detail: string;
}

export function getComparisonHighlights(
  first: Recommendation,
  second: Recommendation,
  decision: DraftDecisionView,
  // Kept for callers: the highlights now say "the rankings" whatever the ranking source is called.
  _display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
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
        detail: `${leader.playerName} projects ${String(Number(difference.toFixed(1)))} more pts over a fill-in starter.`,
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
      detail: `${leader.playerName} is #${String(leaderRank)} in the rankings, ${String(difference)} place${difference === 1 ? '' : 's'} ahead.`,
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
