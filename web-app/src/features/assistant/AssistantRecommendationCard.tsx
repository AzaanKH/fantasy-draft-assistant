import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatSignedNumber } from '@/lib/utils';
import {
  type Player,
  type Position,
  type PositionNeed,
  type Recommendation,
} from '@fantasy-draft/shared';
import { Check, GitCompareArrows, ListPlus, Target } from 'lucide-react';
import * as React from 'react';

import {
  getAvailabilitySignal,
  getNeedTone,
  getSignalSurface,
  getSignalValueColor,
  SignalTone,
  survivalPercent,
} from './assistant-analysis';

export function RecommendationCard({
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

