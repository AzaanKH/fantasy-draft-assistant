import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { MotionReorderItem } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { cn, formatSignedNumber } from '@/lib/utils';
import { type Player, type Recommendation } from '@fantasy-draft/shared';
import { Check, ListPlus } from 'lucide-react';
import * as React from 'react';

import { survivalPercent } from './assistant-analysis';

export function AssistantRecommendationRow({
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
        'scouting-entry',
        isSelected && 'bg-emerald-500/[0.06] ring-1 ring-inset ring-emerald-500/45'
      )}>
      <span className="scouting-rank" aria-label={`Model rank ${String(rank)}`}>{String(rank)}</span>
      <button
        type="button"
        onClick={() => { onSelect(recommendation.playerId); }}
        aria-pressed={isSelected}
        className="scouting-identity flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PlayerHeadshot
          playerId={recommendation.playerId}
          name={recommendation.playerName}
          position={recommendation.position}
          className="scouting-portrait"
        />
        <span className="min-w-0">
          <span className="block truncate font-bold">{recommendation.playerName}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {player?.team ?? 'FA'} · ECR #{String(diagnostics?.expertRank ?? player?.ecrRank ?? '—')}
          </span>
        </span>
      </button>
      <span className={cn(
        'scouting-position font-mono font-bold',
        recommendation.position === 'WR' && 'text-sky-600 dark:text-sky-300',
        recommendation.position === 'RB' && 'text-emerald-700 dark:text-emerald-300',
        recommendation.position === 'QB' && 'text-red-600 dark:text-red-300',
        recommendation.position === 'TE' && 'text-amber-600 dark:text-amber-300',
        recommendation.position === 'K' && 'text-violet-600 dark:text-violet-300'
      )}>
        {recommendation.position}
      </span>
      <span className="scouting-stat"><small>Position tier</small><strong>Tier {String(diagnostics?.tier ?? '—')}</strong></span>
      <span className="scouting-stat"><small>Above replacement</small><strong>{diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'}</strong></span>
      <span className="scouting-actions">
        <span className="scouting-stat"><small>At next pick</small><strong>{survival === null ? '—' : `${String(survival)}%`}</strong></span>
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

