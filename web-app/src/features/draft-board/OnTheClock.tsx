import * as React from 'react';
import type { Player, Position, Recommendation } from '@fantasy-draft/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRecommendations } from '@/hooks/useRecommendations';
import { useDraftStore, useIsMyTurn } from '@/stores/draftStore';
import { cn, formatSignedNumber } from '@/lib/utils';
import { getPicksUntilMyTurn } from './on-the-clock-utils';

const positionColors: Record<Position, string> = {
  QB: 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30',
  RB: 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30',
  WR: 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30',
  TE: 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30',
  K: 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30',
  DEF: 'bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30',
};

function formatNeedLabel(recommendation: Recommendation): string {
  const primaryReason = recommendation.reason.split(' · ')[0] ?? recommendation.reason;
  const rosterNeed = primaryReason.match(/^(critical|high|medium|low) roster need$/);

  if (rosterNeed) {
    const priority = rosterNeed[1] ?? '';
    return `${priority[0]?.toUpperCase() ?? ''}${priority.slice(1)} ${recommendation.position} need`;
  }

  return `${primaryReason[0]?.toUpperCase() ?? ''}${primaryReason.slice(1)}`;
}

function formatAlternatives(recommendations: readonly Recommendation[]): string {
  return recommendations
    .slice(1, 3)
    .map((recommendation) => recommendation.playerName)
    .join(' · ');
}

export function OnTheClock({
  players,
  onDraft,
}: {
  players: readonly Player[];
  onDraft: (player: Player) => void;
}): React.ReactElement | null {
  const [showWhy, setShowWhy] = React.useState(false);
  const { draftNow, topPick, isLoading } = useRecommendations(3);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const isMyTurn = useIsMyTurn();
  const topPlayer = topPick
    ? players.find((player) => player.id === topPick.playerId)
    : undefined;
  const alternatives = formatAlternatives(draftNow);
  const likelyTargets = draftNow
    .slice(0, 2)
    .map((recommendation) => recommendation.playerName)
    .join(', ');
  const picksUntilMyTurn = getPicksUntilMyTurn(
    currentPick,
    config.myPickPosition,
    config.totalTeams,
    config.totalRounds
  );

  if (isLoading || !topPick) {
    return null;
  }

  if (!isMyTurn) {
    return (
      <section className="sticky top-0 z-20 -mx-px border-y border-border/80 bg-card/95 px-6 py-3 shadow-sm backdrop-blur xl:hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {picksUntilMyTurn === null
              ? 'Draft complete'
              : `Next pick in ${String(picksUntilMyTurn)}`}
          </span>
          <span className="text-sm text-muted-foreground">
            Watching the board
            {likelyTargets && ` · likely targets: ${likelyTargets}`}
          </span>
        </div>
      </section>
    );
  }

  const diagnostics = topPick.diagnostics;
  const survivalProbability = diagnostics?.nextPickSurvivalProbability;

  return (
    <section className="sticky top-0 z-20 -mx-px border-y border-emerald-500/30 bg-card/95 px-6 py-3 shadow-sm backdrop-blur xl:hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              Your pick · #{currentPick}
            </span>
            <Badge
              variant="outline"
              className={cn('h-5 px-1.5 font-mono text-[10px]', positionColors[topPick.position])}
            >
              {topPick.position}
            </Badge>
          </div>
          <div className="mt-1 text-lg font-bold leading-tight">{topPick.playerName}</div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{formatNeedLabel(topPick)}</span>
            {diagnostics && (
              <>
                <span>·</span>
                <span className="font-mono tabular-nums">
                  VOR {formatSignedNumber(diagnostics.valueOverReplacement, 0)}
                </span>
              </>
            )}
            {typeof survivalProbability === 'number' && (
              <>
                <span>·</span>
                <span className="font-mono tabular-nums">
                  {Math.round(survivalProbability * 100)}% chance to survive
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            onClick={() => {
              if (topPlayer) onDraft(topPlayer);
            }}
            disabled={!topPlayer}
          >
            Draft
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={showWhy}
            onClick={() => {
              setShowWhy((isOpen) => !isOpen);
            }}
          >
            Why?
          </Button>
        </div>
      </div>

      {(alternatives || showWhy) && (
        <div className="mt-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
          {showWhy && <div className="mb-1">{topPick.reason}</div>}
          {alternatives && (
            <div>
              <span className="font-medium text-foreground">Alternatives:</span>{' '}
              {alternatives}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
