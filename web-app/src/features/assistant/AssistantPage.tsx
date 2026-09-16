import * as React from 'react';
import {
  POSITIONS,
  type Player,
  type Position,
  type PositionNeed,
  type Recommendation,
} from '@fantasy-draft/shared';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  GitCompareArrows,
  ListPlus,
  ShieldQuestion,
  Target,
} from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import {
  DecisionSwap,
  MotionIdentitySwap,
  MotionMetricSwap,
  MotionReorderItem,
  StatePulseDot,
} from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { getPositionRecommendations } from '@/features/assistant/assistant-position-rankings';
import type { AssistantLens } from '@/features/assistant/assistant-navigation';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import {
  getPreferredRecommendation,
  getRecommendationPolicyLabel,
  type DraftDecisionView,
} from '@/features/recommendations/draft-decision';
import { getRecommendationExplanation } from '@/features/recommendations/recommendation-explanation';
import { DraftReadinessBlockedNotice } from '@/features/draft-room/DraftReadinessBlockedNotice';
import { ProviderIdentityBlockedNotice } from '@/features/draft-room/ProviderIdentityBlockedNotice';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useTeamNeeds } from '@/hooks/useTeamNeeds';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { cn, formatSignedNumber } from '@/lib/utils';
import { useDraftStore } from '@/stores/draftStore';

type PositionFilter = 'ALL' | Position;
type PoolSort = 'recommendation' | 'tier';

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', ...POSITIONS];
const RECOMMENDATION_GRID_MEDIA_QUERIES = {
  medium: '(min-width: 48rem)',
  large: '(min-width: 64rem)',
  extraLarge: '(min-width: 80rem)',
  twoExtraLarge: '(min-width: 96rem)',
} as const;

type SignalTone = 'positive' | 'caution' | 'urgent' | 'neutral';

const lenses: readonly {
  readonly id: AssistantLens;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof ShieldQuestion;
}[] = [
  {
    id: 'why',
    label: 'Why this player?',
    description: 'Explain the selected player',
    icon: ShieldQuestion,
  },
  {
    id: 'compare',
    label: 'Compare options',
    description: 'Selected player versus the best alternative',
    icon: GitCompareArrows,
  },
  {
    id: 'wait',
    label: 'Can I wait?',
    description: 'See if the selected player will return',
    icon: Clock3,
  },
  {
    id: 'roster',
    label: 'What does my roster need?',
    description: 'Balance need and scarcity',
    icon: Target,
  },
];

function getCollapsedPlayerCount(): number {
  if (typeof window === 'undefined') return 3;
  if (document.documentElement.hasAttribute('data-visual-test')) return 10;
  if (window.matchMedia(RECOMMENDATION_GRID_MEDIA_QUERIES.twoExtraLarge).matches) return 5;
  if (window.matchMedia(RECOMMENDATION_GRID_MEDIA_QUERIES.extraLarge).matches) return 4;
  return 3;
}

function subscribeToRecommendationGrid(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const mediaQueries = Object.values(RECOMMENDATION_GRID_MEDIA_QUERIES)
    .map((query) => window.matchMedia(query));
  mediaQueries.forEach((query) => { query.addEventListener('change', listener); });

  return () => {
    mediaQueries.forEach((query) => { query.removeEventListener('change', listener); });
  };
}

function useCollapsedPlayerCount(): number {
  return React.useSyncExternalStore(
    subscribeToRecommendationGrid,
    getCollapsedPlayerCount,
    () => 3
  );
}

function getUsesDesktopPlayerPool(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia(RECOMMENDATION_GRID_MEDIA_QUERIES.large).matches;
}

function useUsesDesktopPlayerPool(): boolean {
  return React.useSyncExternalStore(
    subscribeToRecommendationGrid,
    getUsesDesktopPlayerPool,
    () => false
  );
}

function survivalPercent(recommendation: Recommendation): number | null {
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

function getSignalSurface(tone: SignalTone): string {
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

function getSignalValueColor(tone: SignalTone): string {
  return {
    positive: 'text-emerald-700 dark:text-emerald-300',
    caution: 'text-amber-800 dark:text-amber-300',
    urgent: 'text-red-700 dark:text-red-300',
    neutral: 'text-foreground',
  }[tone];
}

function getNeedTone(need: PositionNeed | undefined): SignalTone {
  if (need?.priority === 'critical') return 'urgent';
  if (need?.priority === 'high') return 'caution';
  if (need?.priority === 'medium') return 'positive';
  return 'neutral';
}

function getNeedSlotSummary(need: PositionNeed): string {
  const fixedSummary = `${String(need.startersFilled)} of ${String(need.startersNeeded)} ${need.position} fixed starter slots filled`;
  if (!need.isFlexEligible || need.flexSlotsNeeded === 0) return fixedSummary;
  return `${fixedSummary}; ${String(need.flexSlotsFilled)} of ${String(need.flexSlotsNeeded)} shared FLEX starter slots filled`;
}

function getAvailabilitySignal(survival: number | null): {
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

function getRecommendationChangeAnswer(
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

interface ComparisonHighlight {
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

function CalculationDetails({ explanation }: { readonly explanation: string }): React.ReactElement {
  return (
    <details className="group mt-5 border-t border-border/70 pt-4 xl:mt-6 xl:pt-5">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md text-sm font-semibold text-foreground outline-none hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card dark:hover:text-emerald-300 [&::-webkit-details-marker]:hidden">
        Show details
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <p className="motion-expandable mt-3 max-w-4xl text-sm leading-6 text-muted-foreground xl:text-base xl:leading-7">
        {explanation}
      </p>
    </details>
  );
}

function RecommendationCard({
  recommendation,
  player,
  rank,
  isSelected,
  isComparisonTarget,
  isQueued,
  need,
  rankScope,
  compareWithPlayerName,
  onSelect,
  onCompare,
  onQueue,
}: {
  readonly recommendation: Recommendation;
  readonly player?: Player;
  readonly rank: number;
  readonly isSelected: boolean;
  readonly isComparisonTarget: boolean;
  readonly isQueued: boolean;
  readonly need?: PositionNeed;
  readonly rankScope?: Position;
  readonly compareWithPlayerName?: string;
  readonly onSelect: (playerId: string) => void;
  readonly onCompare?: (playerId: string) => void;
  readonly onQueue: (playerId: string) => void;
}): React.ReactElement {
  const diagnostics = recommendation.diagnostics;
  const survival = survivalPercent(recommendation);
  const availability = getAvailabilitySignal(survival);
  const replacementPoints = diagnostics
    ? diagnostics.replacementPoints ?? diagnostics.projectedPoints - diagnostics.valueOverReplacement
    : null;
  const tierTone: SignalTone = diagnostics?.isLastInTier ? 'caution' : 'neutral';
  const vorTone: SignalTone = diagnostics && diagnostics.valueOverReplacement > 0
    ? 'positive'
    : 'neutral';
  const needTone = getNeedTone(need);
  const needLabel = need && !['filled', 'defer', 'low'].includes(need.priority)
    ? `${need.priority === 'critical' ? 'Critical' : need.priority === 'high' ? 'High' : 'Open'} ${need.position} need`
    : null;
  const canChooseComparison = onCompare !== undefined && compareWithPlayerName !== undefined;

  return (
    <article data-player-row className={cn(
      'relative rounded-xl border bg-card p-4 shadow-xs transition-colors',
      isSelected
        ? 'border-emerald-500/60 ring-1 ring-emerald-500/25'
        : isComparisonTarget
          ? 'border-sky-500/60 ring-1 ring-sky-500/25'
        : 'border-border/70 hover:border-border'
    )}>
      <button
        type="button"
        aria-label={`View decision analysis for ${recommendation.playerName}`}
        aria-pressed={isSelected}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => { onSelect(recommendation.playerId); }}
      />
      <div className="pointer-events-none relative z-[1] flex items-start gap-3">
        <PlayerHeadshot
          playerId={recommendation.playerId}
          name={recommendation.playerName}
          position={recommendation.position}
          className="size-16 rounded-xl border border-border/70"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn(
              'font-mono text-[10px]',
              rank === 1
                ? 'bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-emerald-950'
                : 'bg-muted text-foreground hover:bg-muted'
            )}>
              {rankScope
                ? `#${String(rank)} available`
                : rank === 1
                  ? '#1 pick'
                  : `#${String(rank)} option`}
            </Badge>
            <h3 className="truncate font-bold">{recommendation.playerName}</h3>
            <Badge variant="outline" className="font-mono text-[10px]">
              {recommendation.position}
            </Badge>
            {isSelected ? (
              <Badge className="bg-emerald-500/15 text-[10px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
                Viewing
              </Badge>
            ) : null}
            {isComparisonTarget ? (
              <Badge className="bg-sky-500/15 text-[10px] text-sky-700 hover:bg-sky-500/15 dark:text-sky-300">
                Comparing
              </Badge>
            ) : null}
            {player?.team ? (
              <span className="text-xs text-muted-foreground">{player.team}</span>
            ) : null}
          </div>
          {needLabel ? (
            <div className={cn(
              'mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold',
              getSignalSurface(needTone),
              getSignalValueColor(needTone)
            )}>
              <Target className="size-3" /> {needLabel}
            </div>
          ) : null}
        </div>
      </div>
      <dl className="pointer-events-none relative z-[1] mt-4 grid grid-cols-2 overflow-hidden border-y border-border/70 bg-muted/15">
        <div
          className={cn(getSignalSurface(vorTone), 'col-span-2 border-x-0 border-t-0 border-b border-border/70 px-3 py-3')}
          title="Projected points minus the points from a replacement-level player at the same position."
        >
          <dt className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Value over replacement</span>
            <span className="font-mono normal-case tracking-normal">VOR</span>
          </dt>
          <dd className={cn('mt-1 font-mono text-xl font-bold tabular-nums', getSignalValueColor(vorTone))}>
            {diagnostics ? `${formatSignedNumber(diagnostics.valueOverReplacement, 0)} pts` : '—'}
          </dd>
          <dd className="mt-1 text-[11px] text-muted-foreground">
            {diagnostics && replacementPoints !== null
              ? `${diagnostics.projectedPoints.toFixed(0)} projected − ${replacementPoints.toFixed(0)} replacement`
              : 'Positional advantage is unavailable'}
          </dd>
        </div>
        <div
          className={cn(getSignalSurface(tierTone), 'border-x-0 border-y-0 border-r border-border/70 px-3 py-3')}
          title="Players in the same tier have similar projected value."
        >
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Position tier</dt>
          <dd className={cn('mt-1 font-mono text-lg font-bold', getSignalValueColor(tierTone))}>
            T{String(diagnostics?.tier ?? '—')}
          </dd>
          <dd className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {diagnostics?.isLastInTier
              ? diagnostics.tierDropoffPoints !== undefined
                ? `Last in tier · next tier scores ${diagnostics.tierDropoffPoints.toFixed(1)} fewer`
                : 'Last player in this tier'
              : diagnostics?.tierRemaining !== undefined
                ? `${String(diagnostics.tierRemaining)} similar players left`
                : 'Similar-value player group'}
          </dd>
        </div>
        <div
          className={cn(getSignalSurface(availability.tone), 'border-0 px-3 py-3')}
          title="Estimated chance this player will still be available at your next pick."
        >
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">At your next pick</dt>
          <dd className={cn('mt-1 font-mono text-lg font-bold', getSignalValueColor(availability.tone))}>
            {survival === null ? '—' : `${String(survival)}%`}
          </dd>
          <dd className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {availability.status}
          </dd>
        </div>
      </dl>
      {diagnostics ? (
        <div className="pointer-events-none relative z-[1] mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
          {player ? (
            <span>{player.position} rank <strong className="font-mono text-foreground">#{String(player.positionalRank)}</strong></span>
          ) : null}
          <span>Overall ECR <strong className="font-mono text-foreground">#{String(diagnostics.expertRank)}</strong></span>
          <span>Draft spot <strong className="font-mono text-foreground">#{String(diagnostics.marketRank)}</strong></span>
          {diagnostics.marketDelta > 0 ? (
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
              {formatSignedNumber(diagnostics.marketDelta, 0)} picks of value
            </span>
          ) : diagnostics.marketDelta < 0 ? (
            <span className="font-semibold text-amber-800 dark:text-amber-300">
              {Math.abs(diagnostics.marketDelta).toFixed(0)}-pick reach
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={cn('relative z-10 mt-3 grid gap-2', canChooseComparison && 'grid-cols-2')}>
        <Button
          variant={isQueued ? 'secondary' : 'outline'}
          size="sm"
          className="min-w-0 w-full"
          onClick={() => { onQueue(recommendation.playerId); }}
        >
          {isQueued ? <Check className="size-4" /> : <ListPlus className="size-4" />}
          <span className="truncate">
            {canChooseComparison
              ? isQueued ? 'Queued' : 'Queue'
              : isQueued ? 'In draft queue' : 'Add to draft queue'}
          </span>
        </Button>
        {canChooseComparison ? (
          <Button
            variant={isComparisonTarget ? 'secondary' : 'outline'}
            size="sm"
            className="min-w-0 w-full"
            disabled={isSelected}
            aria-pressed={isComparisonTarget}
            aria-label={isSelected
              ? `${recommendation.playerName} is the primary comparison player`
              : `Compare ${recommendation.playerName} with ${compareWithPlayerName}`}
            title={isSelected
              ? 'Primary comparison player'
              : `Compare with ${compareWithPlayerName}`}
            onClick={() => { onCompare(recommendation.playerId); }}
          >
            {isComparisonTarget ? <Check className="size-4" /> : <GitCompareArrows className="size-4" />}
            <span className="truncate">
              {isSelected ? 'Primary' : isComparisonTarget ? 'Comparing' : 'Compare'}
            </span>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function WhyAnswer({ recommendation, isTopPick, positionRank, preferredExplanation }: {
  readonly recommendation: Recommendation;
  readonly isTopPick: boolean;
  readonly positionRank?: number;
  readonly preferredExplanation?: string;
}): React.ReactElement {
  const sections = getAssistantAnswerSections(recommendation, isTopPick, positionRank);
  const fullExplanation = preferredExplanation ?? getRecommendationExplanation(recommendation);

  return (
    <div className="max-w-5xl">
      <dl className="divide-y divide-border/70">
        {sections.map((section) => (
          <div
            key={section.label}
            className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-5 xl:py-4"
          >
            <dt className={cn(
              'text-xs font-bold uppercase tracking-[0.12em] xl:text-sm',
              getSignalValueColor(section.tone)
            )}>
              {section.label}
            </dt>
            <dd className="text-sm font-medium leading-6 text-foreground xl:text-base xl:leading-7">
              {section.answer}
            </dd>
          </div>
        ))}
      </dl>
      <CalculationDetails explanation={fullExplanation} />
    </div>
  );
}

function CompareAnswer({
  recommendations,
  availableComparisons,
  decision,
  onComparisonPlayerChange,
}: {
  readonly recommendations: readonly Recommendation[];
  readonly availableComparisons: readonly Recommendation[];
  readonly decision: DraftDecisionView;
  readonly onComparisonPlayerChange: (playerId: string) => void;
}): React.ReactElement {
  const [first, second] = recommendations;
  if (!first || !second) {
    return <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">A second comparable option is not available yet.</p>;
  }

  const firstDiagnostics = first.diagnostics;
  const secondDiagnostics = second.diagnostics;
  const preferred = getPreferredRecommendation(decision, [first, second]) ?? first;
  const firstIsStronger = preferred.playerId === first.playerId;
  const preferredExplanation = decision.explanationByPlayerId.get(preferred.playerId)
    ?? getRecommendationExplanation(preferred);
  const highlights = getComparisonHighlights(first, second, decision);
  const rows = [
    {
      label: 'Recommendation rank',
      first: `#${String(decision.rankByPlayerId.get(first.playerId) ?? '—')}`,
      second: `#${String(decision.rankByPlayerId.get(second.playerId) ?? '—')}`,
    },
    {
      label: 'ECR anchor',
      first: `#${String(firstDiagnostics?.expertRank ?? '—')}`,
      second: `#${String(secondDiagnostics?.expertRank ?? '—')}`,
    },
    {
      label: 'Above replacement',
      first: firstDiagnostics ? formatSignedNumber(firstDiagnostics.valueOverReplacement, 0) : '—',
      second: secondDiagnostics ? formatSignedNumber(secondDiagnostics.valueOverReplacement, 0) : '—',
    },
    {
      label: 'Position tier',
      first: `T${String(firstDiagnostics?.tier ?? '—')}`,
      second: `T${String(secondDiagnostics?.tier ?? '—')}`,
    },
    {
      label: 'Return Probability',
      first: survivalPercent(first) === null ? '—' : `${String(survivalPercent(first))}%`,
      second: survivalPercent(second) === null ? '—' : `${String(survivalPercent(second))}%`,
    },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 border-y border-border/70 bg-muted/20 p-4 sm:flex-row sm:items-end sm:justify-between xl:p-5 2xl:mb-7 2xl:p-6">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground xl:text-sm 2xl:text-base">
            Player A · highlighted
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <strong className="text-lg xl:text-xl 2xl:text-2xl">{first.playerName}</strong>
            <Badge variant="outline" className="font-mono xl:text-sm 2xl:text-base">
              {first.position}
            </Badge>
          </div>
        </div>
        <div className="min-w-0 sm:w-[360px] xl:w-[420px] 2xl:w-[480px]">
          <label
            htmlFor="comparison-player"
            className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground xl:text-sm 2xl:text-base"
          >
            Player B · choose player
          </label>
          <Select
            id="comparison-player"
            className="w-full xl:h-11 xl:text-base 2xl:h-12 2xl:text-lg"
            value={second.playerId}
            onValueChange={onComparisonPlayerChange}
            options={availableComparisons.map((recommendation) => ({
              value: recommendation.playerId,
              label: `${recommendation.playerName} · ${recommendation.position}`,
            }))}
          />
        </div>
      </div>
      <DecisionSwap motionKey={second.playerId}>
        <h2 className="max-w-5xl text-lg font-semibold leading-snug xl:text-xl 2xl:text-2xl">
          {firstIsStronger
            ? `${first.playerName} grades ahead of ${second.playerName} for this pick.`
            : `${second.playerName} grades ahead of ${first.playerName}; here is the tradeoff.`}
        </h2>
        <section className="mt-4" aria-labelledby="meaningful-differences-heading">
          <h3 id="meaningful-differences-heading" className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground xl:text-sm">
            Meaningful differences
          </h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {(highlights.length > 0 ? highlights : [{
              label: 'Near tie',
              detail: 'League value, position tier, and Return Probability are close enough that roster preference can decide.',
            }]).map((highlight) => (
              <div key={highlight.label} className="border-l-2 border-emerald-500/40 bg-emerald-500/[0.06] px-3 py-3">
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{highlight.label}</div>
                <p className="mt-1 text-sm leading-5 text-foreground">{highlight.detail}</p>
              </div>
            ))}
          </div>
        </section>
        <p className="mt-4 max-w-5xl text-sm leading-6 text-muted-foreground xl:text-base xl:leading-7">
          The current Decision Policy weighs player quality against league value, roster fit, tier supply, and next-pick timing. That gives {preferred.playerName} the edge for this pick.
        </p>
        <div className="mt-4 overflow-hidden border-y border-border/70 xl:mt-6 2xl:mt-7">
          <div className="grid grid-cols-[1.2fr_1fr_1fr] bg-muted/35 px-3 py-2 text-xs font-semibold xl:px-5 xl:py-4 xl:text-base 2xl:px-6 2xl:text-lg">
            <span>Signal</span>
            <span className="truncate">{first.playerName}</span>
            <span className="truncate">{second.playerName}</span>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1.2fr_1fr_1fr] border-t px-3 py-2 text-xs xl:px-5 xl:py-4 xl:text-base 2xl:px-6 2xl:text-lg">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-mono font-semibold">{row.first}</span>
              <span className="font-mono">{row.second}</span>
            </div>
          ))}
        </div>
        <CalculationDetails explanation={preferredExplanation} />
      </DecisionSwap>
    </div>
  );
}

function AssistantComparisonSnapshot({
  recommendations,
  playerById,
  decision,
}: {
  readonly recommendations: readonly Recommendation[];
  readonly playerById: ReadonlyMap<string, Player>;
  readonly decision: DraftDecisionView;
}): React.ReactElement | null {
  const [first, second] = recommendations;
  if (!first || !second) return null;

  const firstPlayer = playerById.get(first.playerId);
  const secondPlayer = playerById.get(second.playerId);
  const preferredPlayerId = getPreferredRecommendation(decision, [first, second])?.playerId;
  const firstSurvival = survivalPercent(first);
  const secondSurvival = survivalPercent(second);
  const rows = [
    {
      label: 'Recommendation rank',
      first: `#${String(decision.rankByPlayerId.get(first.playerId) ?? '—')}`,
      second: `#${String(decision.rankByPlayerId.get(second.playerId) ?? '—')}`,
    },
    {
      label: 'Position',
      first: first.position,
      second: second.position,
    },
    {
      label: 'Team',
      first: firstPlayer?.team ?? 'FA',
      second: secondPlayer?.team ?? 'FA',
    },
    {
      label: 'Above replacement',
      first: first.diagnostics ? formatSignedNumber(first.diagnostics.valueOverReplacement, 0) : '—',
      second: second.diagnostics ? formatSignedNumber(second.diagnostics.valueOverReplacement, 0) : '—',
    },
    {
      label: 'Position tier',
      first: `Tier ${String(first.diagnostics?.tier ?? '—')}`,
      second: `Tier ${String(second.diagnostics?.tier ?? '—')}`,
    },
    {
      label: 'At next pick',
      first: firstSurvival === null ? '—' : `${String(firstSurvival)}%`,
      second: secondSurvival === null ? '—' : `${String(secondSurvival)}%`,
    },
  ];

  return (
    <aside className="hidden min-w-0 overflow-hidden rounded-xl border border-border/75 bg-card shadow-sm 2xl:block" aria-label="Quick player comparison">
      <div className="border-b border-border/70 px-5 py-4">
        <h2 className="text-lg font-bold">Quick comparison</h2>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">Current recommendation versus the best alternative</p>
      </div>
      <div className="grid grid-cols-[124px_minmax(0,1fr)_minmax(0,1fr)] border-b border-border/70 bg-muted/20 text-sm">
        <div className="p-4 font-semibold text-muted-foreground">Player</div>
        {[first, second].map((recommendation) => (
          <div key={recommendation.playerId} className="min-w-0 border-l border-border/70 p-4 text-center">
            <PlayerHeadshot
              playerId={recommendation.playerId}
              name={recommendation.playerName}
              position={recommendation.position}
              className="mx-auto size-16 rounded-lg border border-border/70"
            />
            <div className="mt-2 truncate font-bold">{recommendation.playerName}</div>
            {recommendation.playerId === preferredPlayerId ? (
              <div className="mt-1 font-mono text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Preferred
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[124px_minmax(0,1fr)_minmax(0,1fr)] border-b border-border/60 text-sm last:border-b-0">
          <span className="px-4 py-3 text-muted-foreground">{row.label}</span>
          <span className={cn(
            'border-l border-border/60 px-4 py-3 text-center font-mono',
            preferredPlayerId === first.playerId && 'font-semibold text-emerald-700 dark:text-emerald-300'
          )}>
            {row.first}
          </span>
          <span className={cn(
            'border-l border-border/60 px-4 py-3 text-center font-mono',
            preferredPlayerId === second.playerId && 'font-semibold text-emerald-700 dark:text-emerald-300'
          )}>
            {row.second}
          </span>
        </div>
      ))}
    </aside>
  );
}

function WaitAnswer({ recommendation }: { readonly recommendation: Recommendation }): React.ReactElement {
  const survival = survivalPercent(recommendation);
  const diagnostics = recommendation.diagnostics;
  const expectedAlternative = recommendation.decisionFactors?.draftTiming.expectedAlternative
    ?? diagnostics?.expectedNextPickAlternative;
  if (survival === null) {
    return <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">Survival estimates are still being calculated.</p>;
  }

  return (
    <div className="max-w-5xl">
      <p className="text-lg font-semibold leading-snug xl:text-[1.875rem] xl:leading-[1.2] 2xl:text-4xl">
        Return Probability for {recommendation.playerName} at pick {diagnostics?.nextPickLabel ?? 'your next selection'} is {String(survival)}%.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground xl:mt-6 xl:text-xl 2xl:mt-7 2xl:text-2xl">
        {survival < 35
          ? `Waiting on ${recommendation.playerName} is high risk; treat this as the likely decision point if the player fits your plan.`
          : survival < 70
            ? `${recommendation.playerName} may return, but the board still carries meaningful uncertainty.`
            : `The model expects ${recommendation.playerName} to remain available, so waiting is a reasonable option.`}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground xl:mt-6 xl:text-xl 2xl:text-2xl">
        {expectedAlternative
          ? `If ${recommendation.playerName} is gone, ${expectedAlternative.playerName} is the expected ${recommendation.position} fallback at ${formatSignedNumber(expectedAlternative.expectedValue, 0)} expected points above replacement.`
          : `No same-position fallback is projected for that selection.`}
      </p>
      {diagnostics?.survivalModelSource === 'league-history' ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground xl:text-base 2xl:text-lg">
          Primary League history supplies 70% of the timing estimate. Current consensus market cost supplies 25%; Sleeper search rank supplies 5%.
        </p>
      ) : null}
    </div>
  );
}

function RosterAnswer({ needs, recommendation }: {
  readonly needs: readonly PositionNeed[];
  readonly recommendation: Recommendation;
}): React.ReactElement {
  const selectedNeed = needs.find((need) => need.position === recommendation.position);
  const isActionable = selectedNeed && !['filled', 'defer'].includes(selectedNeed.priority);

  return (
    <div className="max-w-5xl">
      <p className="text-lg font-semibold leading-snug xl:text-[1.875rem] xl:leading-[1.2] 2xl:text-4xl">
        {selectedNeed
          ? `${selectedNeed.position} is a ${selectedNeed.priority} roster need right now.`
          : `${recommendation.position} roster context is unavailable.`}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground xl:mt-6 xl:text-xl 2xl:mt-7 2xl:text-2xl">
        {selectedNeed
          ? `${getNeedSlotSummary(selectedNeed)}, with a scarcity score of ${selectedNeed.scarcityScore.toFixed(1)}.`
          : 'Use the remaining picks for value, upside, and bench depth.'}
        {isActionable ? ` ${recommendation.playerName} would address that need.` : ''}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 xl:mt-6 xl:gap-3 2xl:mt-7">
        {needs.map((need) => (
          <Badge
            key={need.position}
            variant="outline"
            className={cn(
              'font-mono xl:px-3 xl:py-1 xl:text-base 2xl:text-lg',
              need.priority === 'critical' && 'border-red-500/40 text-red-700 dark:text-red-300',
              need.priority === 'high' && 'border-orange-500/40 text-orange-700 dark:text-orange-300'
            )}
          >
            {need.position} · {need.priority}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function AssistantRecommendationRow({
  recommendation,
  player,
  rank,
  order,
  isSelected,
  isQueued,
  onSelect,
  onQueue,
}: {
  readonly recommendation: Recommendation;
  readonly player?: Player;
  readonly rank: number;
  readonly order: number;
  readonly isSelected: boolean;
  readonly isQueued: boolean;
  readonly onSelect: (playerId: string) => void;
  readonly onQueue: (playerId: string) => void;
}): React.ReactElement {
  const diagnostics = recommendation.diagnostics;
  const survival = survivalPercent(recommendation);

  return (
    <div data-player-row>
      <MotionReorderItem order={order} className={cn(
        'grid grid-cols-[56px_minmax(220px,1.4fr)_70px_90px_150px_130px] items-center gap-3 border-t border-border/60 px-3 py-2.5 text-xs transition-colors first:border-t-0 hover:bg-muted/25',
        isSelected && 'bg-emerald-500/[0.06] ring-1 ring-inset ring-emerald-500/45'
      )}>
      <span className="text-center font-mono text-muted-foreground">{String(rank)}</span>
      <button
        type="button"
        onClick={() => { onSelect(recommendation.playerId); }}
        className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PlayerHeadshot
          playerId={recommendation.playerId}
          name={recommendation.playerName}
          position={recommendation.position}
          className="size-10 rounded-lg border border-border/70"
        />
        <span className="min-w-0">
          <span className="block truncate font-bold">{recommendation.playerName}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {player?.team ?? 'FA'} · ECR #{String(diagnostics?.expertRank ?? player?.ecrRank ?? '—')}
          </span>
        </span>
      </button>
      <span className={cn(
        'font-mono font-bold',
        recommendation.position === 'WR' && 'text-sky-600 dark:text-sky-300',
        recommendation.position === 'RB' && 'text-emerald-700 dark:text-emerald-300',
        recommendation.position === 'QB' && 'text-red-600 dark:text-red-300',
        recommendation.position === 'TE' && 'text-amber-600 dark:text-amber-300',
        recommendation.position === 'K' && 'text-violet-600 dark:text-violet-300'
      )}>
        {recommendation.position}
      </span>
      <span className="font-mono">Tier {String(diagnostics?.tier ?? '—')}</span>
      <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
        {diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'} above replacement
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono">{survival === null ? '—' : `${String(survival)}%`}</span>
        <Button
          variant={isQueued ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => { onQueue(recommendation.playerId); }}
        >
          {isQueued ? <Check className="size-3.5" /> : <ListPlus className="size-3.5" />}
          {isQueued ? 'Queued' : 'Queue'}
        </Button>
      </span>
      </MotionReorderItem>
    </div>
  );
}

export function AssistantPage({
  initialLens = 'why',
  initialSelectedPlayerId = null,
  onReturnToDraft,
}: {
  readonly initialLens?: AssistantLens;
  readonly initialSelectedPlayerId?: string | null;
  readonly onReturnToDraft: () => void;
}): React.ReactElement {
  const [lens, setLens] = React.useState<AssistantLens>(initialLens);
  const [showAllPlayers, setShowAllPlayers] = React.useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = React.useState<string | null>(
    initialSelectedPlayerId
  );
  const [comparisonPlayerId, setComparisonPlayerId] = React.useState<string | null>(null);
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [poolSort, setPoolSort] = React.useState<PoolSort>('recommendation');
  const analysisPanelRef = React.useRef<HTMLElement>(null);
  const collapsedPlayerCount = useCollapsedPlayerCount();
  const usesDesktopPlayerPool = useUsesDesktopPlayerPool();
  const decision = useDraftDecision();
  const { players } = usePlayerDataQuery();
  const { needs } = useTeamNeeds();
  const config = useDraftStore((state) => state.config);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const queuedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const { togglePlayerQueued } = useQueueActions(players);
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const activeDecision = positionFilter === 'ALL'
    ? decision.overall
    : decision.byPosition[positionFilter];
  const topPick = activeDecision.preferred;
  const filteredRecommendations = positionFilter === 'ALL'
    ? activeDecision.recommendations
    : getPositionRecommendations(activeDecision);
  const poolRecommendations = React.useMemo(
    () => sortRecommendationsForPool(filteredRecommendations, poolSort),
    [filteredRecommendations, poolSort]
  );
  const modelRankByPlayerId = activeDecision.rankByPlayerId;
  const selectedRecommendation = filteredRecommendations.find(
    (recommendation) => recommendation.playerId === selectedPlayerId
  ) ?? filteredRecommendations[0] ?? topPick;
  const availableComparisons = selectedRecommendation
    ? filteredRecommendations.filter(
        (recommendation) => recommendation.playerId !== selectedRecommendation.playerId
      )
    : [];
  const comparisonRecommendation = availableComparisons.find(
    (recommendation) => recommendation.playerId === comparisonPlayerId
  ) ?? availableComparisons[0];
  const comparisonRecommendations: readonly Recommendation[] = selectedRecommendation
    ? comparisonRecommendation
      ? [selectedRecommendation, comparisonRecommendation]
      : [selectedRecommendation]
    : [];
  const cards = showAllPlayers
    ? poolRecommendations
    : poolRecommendations.slice(0, collapsedPlayerCount);
  const hiddenPlayerCount = poolRecommendations.length - cards.length;
  const selectedPositionNeed = positionFilter === 'ALL'
    ? undefined
    : needs.find((need) => need.position === positionFilter);
  const selectedPositionIndex = selectedRecommendation
    ? filteredRecommendations.findIndex(
        (recommendation) => recommendation.playerId === selectedRecommendation.playerId
      )
    : -1;
  const selectedPositionRank = positionFilter !== 'ALL' && selectedPositionIndex >= 0
    ? selectedPositionIndex + 1
    : undefined;
  const handleSelectPlayer = React.useCallback((playerId: string): void => {
    setSelectedPlayerId(playerId);
    setComparisonPlayerId(null);
  }, []);
  const handleCompareFromCard = React.useCallback((playerId: string): void => {
    setLens('compare');
    setComparisonPlayerId(playerId);
    window.requestAnimationFrame(() => {
      analysisPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  if (decision.recommendationsBlockedByProviderIdentity) {
    return (
      <main className="w-full px-4 py-4">
        <Button variant="outline" size="sm" onClick={onReturnToDraft}>
          <ArrowLeft className="size-4" /> Return to Draft Workspace
        </Button>
        <ProviderIdentityBlockedNotice
          unresolvedPicks={decision.unresolvedProviderPicks}
          totalTeams={config.totalTeams}
          className="mx-auto mt-4 max-w-3xl"
        />
      </main>
    );
  }

  if (decision.isLoading) {
    return (
      <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-background text-sm text-muted-foreground">
        Updating league-aware rankings…
      </main>
    );
  }

  if (decision.recommendationsBlocked && decision.readiness) {
    return (
      <main className="w-full px-4 py-4">
        <Button variant="outline" size="sm" onClick={onReturnToDraft}>
          <ArrowLeft className="size-4" /> Return to Draft Workspace
        </Button>
        <DraftReadinessBlockedNotice
          readiness={decision.readiness}
          className="mx-auto mt-4 max-w-3xl"
        />
      </main>
    );
  }

  const selectedPlayer = selectedRecommendation
    ? playerById.get(selectedRecommendation.playerId)
    : undefined;
  const selectedDiagnostics = selectedRecommendation?.diagnostics;
  const selectedSurvival = selectedRecommendation
    ? survivalPercent(selectedRecommendation)
    : null;
  const selectedPlayerCopy = selectedRecommendation
    ? getAssistantPlayerCopy(selectedRecommendation, topPick)
    : null;

  return (
    <main className="w-full px-4 py-4">
      <section className="mb-4 flex min-h-11 flex-wrap items-center justify-between gap-3 border-y border-border/65 bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">
            Pick {formatRoundPick(decision.currentPick, config.totalTeams)} · #{String(decision.currentPick)}
          </span>
          <span className="text-xs text-muted-foreground">{String(config.totalTeams)} teams · {String(config.totalRounds)} rounds · Snake</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <StatePulseDot
            motionKey={`${String(decision.currentPick)}:${topPick?.playerId ?? 'none'}:${sessionMode}`}
            className="size-2 text-emerald-500"
          />
          Same live decision state · {getRecommendationPolicyLabel(activeDecision.selection)} · {sessionMode === 'setup' ? 'preview' : sessionMode}
        </div>
      </section>

      {selectedRecommendation ? (
        <section className="mb-3 overflow-hidden rounded-xl border border-border/75 bg-card shadow-sm">
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center xl:p-5 2xl:gap-6 2xl:p-6">
            <MotionIdentitySwap motionKey={selectedRecommendation.playerId} className="min-w-0">
              <div className="flex min-w-0 items-center gap-4 2xl:gap-5">
                <PlayerHeadshot
                  playerId={selectedRecommendation.playerId}
                  name={selectedRecommendation.playerName}
                  position={selectedRecommendation.position}
                  className="size-24 rounded-xl border border-border/70 2xl:size-28"
                />
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-bold leading-tight xl:text-2xl 2xl:text-3xl">
                    {selectedPlayerCopy?.analysisHeading}
                  </h1>
                  <p className="mt-1 text-sm font-semibold text-foreground xl:text-base 2xl:mt-2 2xl:text-lg">
                    {selectedPlayerCopy?.recommendationStatus}
                  </p>
                  <MotionMetricSwap
                    motionKey={`${String(selectedSurvival)}:${selectedRecommendation.diagnostics?.nextPickLabel ?? 'none'}`}
                    className="mt-1 text-sm text-muted-foreground xl:text-base 2xl:text-lg"
                  >
                    {selectedSurvival === null
                      ? 'Availability is still being calculated.'
                      : `Draft now or wait. Return Probability at pick ${selectedRecommendation.diagnostics?.nextPickLabel ?? 'your next selection'} is ${String(selectedSurvival)}%.`}
                  </MotionMetricSwap>
                  <div className="mt-2 text-sm text-muted-foreground xl:text-base 2xl:text-lg">
                    <span className="font-mono font-bold text-sky-600 dark:text-sky-300">{selectedRecommendation.position}</span>
                    {selectedPlayer?.team ? <span> · {selectedPlayer.team}</span> : null}
                  </div>
                </div>
              </div>
            </MotionIdentitySwap>
            <div className="grid gap-2 2xl:gap-3">
              <Button className="2xl:h-11 2xl:text-base" onClick={onReturnToDraft}>Return to draft <ArrowLeft className="size-4 rotate-180" /></Button>
              <Button
                variant={queuedSet.has(selectedRecommendation.playerId) ? 'secondary' : 'outline'}
                className="2xl:h-11 2xl:text-base"
                onClick={() => { togglePlayerQueued(selectedRecommendation.playerId); }}
              >
                {queuedSet.has(selectedRecommendation.playerId) ? <Check className="size-4" /> : <ListPlus className="size-4" />}
                {queuedSet.has(selectedRecommendation.playerId) ? 'In draft queue' : 'Add to queue'}
              </Button>
            </div>
          </div>
          <dl className="grid border-t border-border/70 sm:grid-cols-3">
            <div className="border-b border-border/70 px-4 py-3 text-center sm:border-b-0 sm:border-r 2xl:py-4">
              <dt>
                <MotionMetricSwap
                  motionKey={selectedDiagnostics?.valueOverReplacement ?? 'none'}
                  className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300 2xl:text-2xl"
                >
                  {selectedDiagnostics ? formatSignedNumber(selectedDiagnostics.valueOverReplacement, 0) : '—'}
                </MotionMetricSwap>
              </dt>
              <dd className="mt-1 text-[11px] text-muted-foreground 2xl:text-sm">above replacement</dd>
            </div>
            <div className="border-b border-border/70 px-4 py-3 text-center sm:border-b-0 sm:border-r 2xl:py-4">
              <dt>
                <MotionMetricSwap
                  motionKey={`${String(selectedDiagnostics?.tier)}:${String(selectedDiagnostics?.isLastInTier)}`}
                  className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300 2xl:text-2xl"
                >
                  Tier {String(selectedDiagnostics?.tier ?? '—')}{selectedDiagnostics?.isLastInTier ? ' · last in tier' : ''}
                </MotionMetricSwap>
              </dt>
              <dd className="mt-1 text-[11px] text-muted-foreground 2xl:text-sm">position tier</dd>
            </div>
            <div className="px-4 py-3 text-center 2xl:py-4">
              <dt>
                <MotionMetricSwap
                  motionKey={selectedSurvival ?? 'none'}
                  className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300 2xl:text-2xl"
                >
                  {selectedSurvival === null ? '—' : `${String(selectedSurvival)}%`}
                </MotionMetricSwap>
              </dt>
              <dd className="mt-1 text-[11px] text-muted-foreground 2xl:text-sm">at your next pick</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)_440px] min-[2200px]:grid-cols-[380px_minmax(0,1fr)_500px]">
        <aside className="rounded-xl border border-border/75 bg-card p-2 shadow-sm 2xl:p-3" aria-label="Assistant questions">
          <div className="px-3 pb-2 pt-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground xl:text-sm 2xl:px-4 2xl:pb-3 2xl:text-base">
            Decision lenses
          </div>
          <div className="space-y-1">
            {lenses.map((item) => {
              const Icon = item.icon;
              const active = lens === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setLens(item.id); }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:py-4 2xl:gap-4 2xl:px-4 2xl:py-5',
                    active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'
                  )}
                >
                  <Icon className="mt-0.5 size-5 shrink-0 xl:size-6 2xl:size-7" />
                  <span>
                    <span className="block text-base font-semibold xl:text-lg 2xl:text-xl">{item.label}</span>
                    <span className={cn(
                      'mt-1 block text-sm leading-snug xl:text-base 2xl:mt-2 2xl:text-lg',
                      active ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    )}>
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section
          ref={analysisPanelRef}
          className="min-w-0 scroll-mt-20 border-y border-border/70 bg-muted/10 p-5 xl:p-8 2xl:p-10"
          aria-live="polite"
        >
          <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300 xl:mb-7 xl:text-base 2xl:mb-8 2xl:gap-3 2xl:text-lg">
            <ShieldQuestion className="size-5 xl:size-6 2xl:size-7" /> Assistant analysis
            {selectedRecommendation ? (
              <Badge variant="outline" className="normal-case tracking-normal text-foreground xl:px-3 xl:text-sm 2xl:text-base">
                {lens === 'compare' && comparisonRecommendation
                  ? `${selectedRecommendation.playerName} vs ${comparisonRecommendation.playerName}`
                  : selectedRecommendation.playerName}
              </Badge>
            ) : null}
          </div>
          <DecisionSwap motionKey={`${lens}:${selectedRecommendation?.playerId ?? 'none'}`}>
            {decision.isLoading ? (
              <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">Updating the decision snapshot…</p>
            ) : !selectedRecommendation ? (
              <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">No available recommendation for this draft state.</p>
            ) : lens === 'why' ? (
              <WhyAnswer
                recommendation={selectedRecommendation}
                isTopPick={selectedRecommendation.playerId === topPick?.playerId}
                positionRank={selectedPositionRank}
                preferredExplanation={activeDecision.explanationByPlayerId.get(selectedRecommendation.playerId)}
              />
            ) : lens === 'compare' ? (
              <CompareAnswer
                recommendations={comparisonRecommendations}
                availableComparisons={availableComparisons}
                decision={activeDecision}
                onComparisonPlayerChange={setComparisonPlayerId}
              />
            ) : lens === 'wait' ? (
              <WaitAnswer recommendation={selectedRecommendation} />
            ) : (
              <RosterAnswer needs={needs} recommendation={selectedRecommendation} />
            )}
          </DecisionSwap>
          <p className="mt-5 max-w-5xl border-t pt-3 text-[11px] leading-relaxed text-muted-foreground xl:mt-7 xl:pt-5 xl:text-base 2xl:mt-8 2xl:text-lg">
            This explanation is derived from the same rankings, roster needs, tiers, and survival estimates shown in Suggestions.
          </p>
        </section>

        <AssistantComparisonSnapshot
          recommendations={comparisonRecommendations}
          playerById={playerById}
          decision={activeDecision}
        />
      </section>

      {activeDecision.recommendations.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-bold">
                {positionFilter === 'ALL' ? 'Recommended player pool' : `Best available ${positionFilter}s`}
              </h2>
              <p className="text-xs text-muted-foreground">
                {positionFilter === 'ALL'
                  ? 'Ranked for this pick using value, roster fit, tiers, and availability.'
                  : `Ranked within ${positionFilter} by the same league-aware policy. Select a player to update the analysis.`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onReturnToDraft}>
              Return to board
            </Button>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 border-y border-border/70 bg-muted/20 p-1">
            <div className="flex min-w-max flex-1 gap-1 overflow-x-auto" role="group" aria-label="Filter recommendations by position">
              {POSITION_FILTERS.map((position) => {
                const active = positionFilter === position;
                const positionNeed = position === 'ALL'
                  ? undefined
                  : needs.find((need) => need.position === position);
                const hasUrgentNeed = positionNeed?.priority === 'critical' || positionNeed?.priority === 'high';

                return (
                  <button
                    key={position}
                    type="button"
                    aria-pressed={active}
                    aria-label={position === 'ALL'
                      ? 'Show all recommended players'
                      : `Show ${position} rankings${positionNeed ? `, ${positionNeed.priority} roster need` : ''}`}
                    onClick={() => {
                      setPositionFilter(position);
                      setSelectedPlayerId(null);
                      setComparisonPlayerId(null);
                      setShowAllPlayers(false);
                    }}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    {position}
                    {position !== 'ALL' && hasUrgentNeed ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-1.5 rounded-full',
                          positionNeed.priority === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                        )}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 px-1">
              <span id="player-pool-sort-label" className="text-xs font-semibold text-muted-foreground">Sort</span>
              <Select
                aria-labelledby="player-pool-sort-label"
                className="h-8 w-[190px] text-xs"
                value={poolSort}
                onValueChange={(value) => { setPoolSort(value as PoolSort); }}
                options={[
                  { value: 'recommendation', label: 'Best recommendation' },
                  { value: 'tier', label: 'Tier first' },
                ]}
              />
            </div>
          </div>
          {selectedPositionNeed ? (
            <div className={cn(
              'mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-x-0 border-y px-3 py-2 text-xs',
              getSignalSurface(getNeedTone(selectedPositionNeed))
            )}>
              <Target className={cn('size-4', getSignalValueColor(getNeedTone(selectedPositionNeed)))} />
              <strong className={getSignalValueColor(getNeedTone(selectedPositionNeed))}>
                {selectedPositionNeed.position} is a {selectedPositionNeed.priority} roster need
              </strong>
              <span className="text-muted-foreground">
                {getNeedSlotSummary(selectedPositionNeed)}
              </span>
            </div>
          ) : null}
          {cards.length > 0 ? (
            usesDesktopPlayerPool ? (
              <div className="overflow-hidden border-y border-border/70">
                <div className="grid grid-cols-[56px_minmax(220px,1.4fr)_70px_90px_150px_130px] gap-3 bg-muted/25 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  <span className="text-center">Model rank</span><span>Player</span><span>Pos</span><span>Tier</span><span>Above replacement</span><span>At next pick</span>
                </div>
                {cards.map((recommendation, order) => (
                  <AssistantRecommendationRow
                    key={recommendation.playerId}
                    recommendation={recommendation}
                    player={playerById.get(recommendation.playerId)}
                    rank={modelRankByPlayerId.get(recommendation.playerId) ?? 0}
                    order={order}
                    isSelected={selectedRecommendation?.playerId === recommendation.playerId}
                    isQueued={queuedSet.has(recommendation.playerId)}
                    onSelect={handleSelectPlayer}
                    onQueue={togglePlayerQueued}
                  />
                ))}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {cards.map((recommendation) => (
                  <RecommendationCard
                    key={recommendation.playerId}
                    recommendation={recommendation}
                    player={playerById.get(recommendation.playerId)}
                    rank={modelRankByPlayerId.get(recommendation.playerId) ?? 0}
                    rankScope={positionFilter === 'ALL' ? undefined : positionFilter}
                    isSelected={selectedRecommendation?.playerId === recommendation.playerId}
                    isComparisonTarget={lens === 'compare' && comparisonRecommendation?.playerId === recommendation.playerId}
                    isQueued={queuedSet.has(recommendation.playerId)}
                    need={needs.find((need) => need.position === recommendation.position)}
                    compareWithPlayerName={lens === 'compare' ? selectedRecommendation?.playerName : undefined}
                    onSelect={handleSelectPlayer}
                    onCompare={lens === 'compare' ? handleCompareFromCard : undefined}
                    onQueue={togglePlayerQueued}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              No available {positionFilter === 'ALL' ? 'players' : positionFilter} players.
            </div>
          )}
          {filteredRecommendations.length > collapsedPlayerCount ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                aria-expanded={showAllPlayers}
                onClick={() => { setShowAllPlayers((current) => !current); }}
              >
                {showAllPlayers ? (
                  <><ChevronUp className="size-4" /> Show fewer players</>
                ) : (
                  <><ChevronDown className="size-4" /> Show {String(hiddenPlayerCount)} more players</>
                )}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
