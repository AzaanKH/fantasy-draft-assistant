import { useDraftView } from '@/workspace/useDraftView';
import * as React from 'react';
import type { Player } from '@fantasy-draft/shared/league';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { ArrowRight, ListPlus } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { LoadingStatus, SkeletonBlock, SkeletonText } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';

/** Card geometry shared by loaded and loading suggestions. */
const CARD = 'flex min-w-0 flex-col rounded-xl border border-border/70 bg-card p-3 shadow-xs';
const HEADSHOT = 'size-14 rounded-lg border border-border/70';
const NAME = 'mt-1 truncate text-sm font-bold';
const EXPLANATION = 'mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground';
const FACTS = 'mt-3 flex flex-wrap gap-1.5 text-[10px]';
const FACT = 'rounded-md bg-muted/55 px-2 py-1 font-mono';
const ACTIONS = 'mt-auto flex gap-2 pt-3';
const SUGGESTION_GRID = 'grid gap-3 lg:grid-cols-3';

function SuggestionCardPlaceholder(): React.ReactElement {
  return (
    <div aria-hidden="true" className={CARD}>
      <div className="flex items-start gap-3">
        <SkeletonBlock className={HEADSHOT} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><SkeletonBlock className="h-5 w-20" /></div>
          <h3 className={NAME}><SkeletonText className="w-32" /></h3>
          <p className={EXPLANATION}><SkeletonText className="w-full" /><br /><SkeletonText className="w-4/5" /></p>
        </div>
      </div>
      <div className={FACTS}>
        <span className={FACT}><SkeletonText className="w-16" /></span>
        <span className={FACT}><SkeletonText className="w-16" /></span>
      </div>
      <div className={ACTIONS}><SkeletonBlock className="h-8 flex-1" /></div>
    </div>
  );
}

function SuggestionCard({
  recommendation,
  explanation,
  rank,
  player,
  canDraft,
  positionAllowed,
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
  readonly positionAllowed: boolean;
  readonly isQueued: boolean;
  readonly onDraft: (player: Player) => void;
  readonly onQueue: (playerId: string) => void;
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const diagnostics = recommendation.diagnostics;
  const survival = diagnostics?.nextPickSurvivalProbability;

  return (
    <article className={CARD}>
      <div className="flex items-start gap-3">
        <PlayerHeadshot
          playerId={recommendation.playerId}
          name={recommendation.playerName}
          position={recommendation.position}
          className={HEADSHOT}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">#{String(rank)}</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {recommendation.position}
            </Badge>
          </div>
          <h3 className={NAME}>{recommendation.playerName}</h3>
          <p className={EXPLANATION}>
            {explanation}
          </p>
        </div>
      </div>

      <div className={FACTS}>
        <span className={FACT}>
          T{String(diagnostics?.tier ?? '—')} · {String(diagnostics?.tierRemaining ?? '—')} left
        </span>
        <span className={FACT}>
          {typeof survival === 'number' ? `${String(Math.round(survival * 100))}% survives` : 'Survival —'}
        </span>
      </div>

      <div className={ACTIONS}>
        {canDraft && player ? (
          <Button
            size="sm"
            className="flex-1"
            disabled={!positionAllowed}
            title={positionAllowed ? undefined : `${recommendation.position} limit reached`}
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
  const queuedPlayerIds = useDraftView((view) => view.shortlistedPlayerIds);
  const { togglePlayerQueued } = useQueueActions(players);
  const { canDraft, canDraftPlayer, draftPlayer } = useDraftPlayerAction();
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);

  if (isLoading) {
    return (
      <div className={SUGGESTION_GRID}>
        <LoadingStatus label="Loading suggestions" />
        {Array.from({ length: 3 }, (_, index) => <SuggestionCardPlaceholder key={index} />)}
      </div>
    );
  }

  return (
    <div className={SUGGESTION_GRID}>
      {overall.recommendations.slice(0, 3).map((recommendation) => (
        <SuggestionCard
          key={recommendation.playerId}
          recommendation={recommendation}
          explanation={overall.explanationByPlayerId.get(recommendation.playerId) ?? recommendation.reason}
          rank={overall.rankByPlayerId.get(recommendation.playerId) ?? 0}
          player={playerById.get(recommendation.playerId)}
          canDraft={canDraft}
          positionAllowed={canDraftPlayer(recommendation)}
          isQueued={queuedSet.has(recommendation.playerId)}
          onDraft={draftPlayer}
          onQueue={togglePlayerQueued}
          onOpenAssistant={onOpenAssistant}
        />
      ))}
    </div>
  );
}
