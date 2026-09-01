import * as React from 'react';
import type { Player, Recommendation } from '@fantasy-draft/shared';
import { ArrowRight, ListPlus } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { SuggestionSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useDraftStore } from '@/stores/draftStore';

function SuggestionCard({
  recommendation,
  explanation,
  rank,
  player,
  canDraft,
  isQueued,
  onDraft,
  onQueue,
  onOpenAssistant,
}: {
  readonly recommendation: Recommendation;
  readonly explanation: string;
  readonly rank: number;
  readonly player?: Player;
  readonly canDraft: boolean;
  readonly isQueued: boolean;
  readonly onDraft: (player: Player) => void;
  readonly onQueue: (playerId: string) => void;
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const diagnostics = recommendation.diagnostics;
  const survival = diagnostics?.nextPickSurvivalProbability;

  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border/70 bg-card p-3 shadow-xs">
      <div className="flex items-start gap-3">
        <PlayerHeadshot
          playerId={recommendation.playerId}
          name={recommendation.playerName}
          position={recommendation.position}
          className="size-14 rounded-lg border border-border/70"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">#{String(rank)}</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {recommendation.position}
            </Badge>
          </div>
          <h3 className="mt-1 truncate text-sm font-bold">{recommendation.playerName}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {explanation}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded-md bg-muted/55 px-2 py-1 font-mono">
          T{String(diagnostics?.tier ?? '—')} · {String(diagnostics?.tierRemaining ?? '—')} left
        </span>
        <span className="rounded-md bg-muted/55 px-2 py-1 font-mono">
          {typeof survival === 'number' ? `${String(Math.round(survival * 100))}% survives` : 'Survival —'}
        </span>
      </div>

      <div className="mt-auto flex gap-2 pt-3">
        {canDraft && player ? (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => {
              onDraft(player);
            }}
          >
            Draft
          </Button>
        ) : (
          <Button
            variant={isQueued ? 'secondary' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => {
              onQueue(recommendation.playerId);
            }}
          >
            <ListPlus className="size-4" />
            {isQueued ? 'Queued' : 'Queue'}
          </Button>
        )}
        {rank === 1 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenAssistant({ lens: 'why', selectedPlayerId: recommendation.playerId });
            }}
          >
            Ask why <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function DraftSuggestions({
  onOpenAssistant,
}: {
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const { overall, isLoading } = useDraftDecision();
  const { players } = usePlayerDataQuery();
  const queuedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const { togglePlayerQueued } = useQueueActions(players);
  const { canDraft, draftPlayer } = useDraftPlayerAction();
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);

  if (isLoading) {
    return <SuggestionSkeleton />;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {overall.recommendations.slice(0, 3).map((recommendation) => (
        <SuggestionCard
          key={recommendation.playerId}
          recommendation={recommendation}
          explanation={overall.explanationByPlayerId.get(recommendation.playerId) ?? recommendation.reason}
          rank={overall.rankByPlayerId.get(recommendation.playerId) ?? 0}
          player={playerById.get(recommendation.playerId)}
          canDraft={canDraft}
          isQueued={queuedSet.has(recommendation.playerId)}
          onDraft={draftPlayer}
          onQueue={togglePlayerQueued}
          onOpenAssistant={onOpenAssistant}
        />
      ))}
    </div>
  );
}
