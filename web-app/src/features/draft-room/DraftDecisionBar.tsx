import * as React from 'react';
import { ArrowRight, Check, ListPlus, LoaderCircle } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { MotionIdentitySwap, MotionMetricSwap } from '@/components/motion';
import { DecisionBarSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { getPicksUntilMyTurn } from '@/features/draft-board/on-the-clock-utils';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useDraftSessionMode, useDraftStore } from '@/stores/draftStore';
import { getDraftDecisionBarReason } from './draft-decision-bar-reason';

function useBoardSequencedRecommendation<T extends { readonly playerId: string }>(
  recommendation: T | null
): T | null {
  const [settledRecommendation, setSettledRecommendation] = React.useState(recommendation);
  const latestRecommendation = React.useRef(recommendation);
  latestRecommendation.current = recommendation;

  React.useEffect(() => {
    if (recommendation?.playerId === settledRecommendation?.playerId) {
      setSettledRecommendation(recommendation);
    }
  }, [recommendation, settledRecommendation?.playerId]);

  React.useEffect(() => {
    if (recommendation?.playerId === settledRecommendation?.playerId) return;
    const timeout = window.setTimeout(() => {
      setSettledRecommendation(latestRecommendation.current);
    }, 520);
    return () => { window.clearTimeout(timeout); };
  }, [recommendation?.playerId, settledRecommendation?.playerId]);

  return settledRecommendation;
}

function EmptyDecisionBar({
  isLoading,
}: {
  readonly isLoading: boolean;
}): React.ReactElement {
  if (isLoading) return <DecisionBarSkeleton />;

  return (
    <section
      className="rounded-xl border border-border/75 bg-card/95 px-4 py-3 shadow-lg shadow-black/[0.04] backdrop-blur"
      aria-label="Current Best Pick"
      aria-busy={isLoading}
    >
      <div className="flex min-h-14 items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/45 text-muted-foreground">
          <LoaderCircle className="size-5" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
            Best Pick
          </p>
          <p className="mt-1 text-sm font-semibold">
            No pick available
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Recommendations will return when another player is available.
          </p>
        </div>
      </div>
    </section>
  );
}

export function DraftDecisionBar({
  onOpenAssistant,
}: {
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const { output, isLoading } = useDraftDecision();
  const bestPick = useBoardSequencedRecommendation(output.bestPick);
  const sessionMode = useDraftSessionMode();
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const isQueued = useDraftStore((state) =>
    bestPick ? state.shortlistedPlayerIds.includes(bestPick.playerId) : false
  );
  const queuePlayerIdentity = React.useMemo(
    () => bestPick ? [{ id: bestPick.playerId, name: bestPick.playerName }] : [],
    [bestPick]
  );
  const { togglePlayerQueued } = useQueueActions(queuePlayerIdentity);

  if (isLoading || !bestPick) {
    return <EmptyDecisionBar isLoading={isLoading} />;
  }

  const diagnostics = bestPick.diagnostics;
  const timing = bestPick.decisionFactors?.draftTiming;
  const returnProbability = timing?.returnProbability ??
    diagnostics?.nextPickSurvivalProbability;
  const nextPickLabel = timing?.nextPickLabel ?? diagnostics?.nextPickLabel;
  const picksUntilMyTurn = getPicksUntilMyTurn(
    currentPick,
    config.myPickPosition,
    config.totalTeams,
    config.totalRounds
  );
  const turnLabel = sessionMode === 'setup'
    ? 'Preview'
    : picksUntilMyTurn === 0
      ? 'Your turn'
      : picksUntilMyTurn === null
        ? 'Draft complete'
        : `${String(picksUntilMyTurn)} picks away`;
  const reason = getDraftDecisionBarReason(
    bestPick,
    output.decisionDivergenceFactor
  );

  return (
    <section
      className="overflow-hidden rounded-xl border border-emerald-500/30 bg-card/95 shadow-lg shadow-emerald-950/[0.06] backdrop-blur supports-[backdrop-filter]:bg-card/90"
      aria-labelledby="current-best-pick-label"
      aria-live="polite"
    >
      <div className="border-l-4 border-l-emerald-500 px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-4">
          <div className="min-w-0">
            <MotionIdentitySwap motionKey={bestPick.playerId} className="flex min-w-0 items-center gap-3">
              <PlayerHeadshot
                playerId={bestPick.playerId}
                name={bestPick.playerName}
                position={bestPick.position}
                className="size-16 rounded-xl border border-emerald-500/25 bg-emerald-500/10 shadow-sm"
              />
              <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  id="current-best-pick-label"
                  className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300"
                >
                  Best Pick
                </span>
                <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                  {bestPick.position}
                </Badge>
                <MotionMetricSwap
                  motionKey={turnLabel}
                  className="text-[10px] font-semibold text-muted-foreground"
                >
                  {turnLabel}
                </MotionMetricSwap>
              </div>
              <h2 className="mt-1 truncate text-lg font-bold leading-tight sm:text-xl">
                {bestPick.playerName}
              </h2>
              </div>
            </MotionIdentitySwap>
            <MotionMetricSwap
              motionKey={reason}
              className="ml-[76px] mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground"
            >
              <span title={reason}>{reason}</span>
            </MotionMetricSwap>
          </div>

          <div className="flex flex-nowrap items-center gap-2 border-t border-border/60 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <div className="mr-auto min-w-20 sm:min-w-24 lg:mr-1">
              <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Return Probability
              </div>
              <MotionMetricSwap
                motionKey={`${String(returnProbability)}:${nextPickLabel ?? 'none'}`}
                className="mt-0.5 font-mono text-xl font-bold leading-none text-foreground"
              >
                {typeof returnProbability === 'number'
                  ? `${String(Math.round(returnProbability * 100))}%`
                  : '—'}
                {nextPickLabel ? (
                  <span className="mt-1 block font-sans text-[10px] font-normal text-muted-foreground">
                    at pick {nextPickLabel}
                  </span>
                ) : null}
              </MotionMetricSwap>
            </div>
            <Button
              variant={isQueued ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={isQueued}
              aria-label={isQueued
                ? `Remove ${bestPick.playerName} from the local queue`
                : `Add ${bestPick.playerName} to the local queue`}
              onClick={() => {
                togglePlayerQueued(bestPick.playerId);
              }}
            >
              {isQueued ? <Check className="size-4" /> : <ListPlus className="size-4" />}
              {isQueued ? 'Queued' : 'Queue'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Open Assistant for ${bestPick.playerName}`}
              onClick={() => {
                onOpenAssistant({ lens: 'why', selectedPlayerId: bestPick.playerId });
              }}
            >
              Assistant <ArrowRight className="hidden size-4 sm:block" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
