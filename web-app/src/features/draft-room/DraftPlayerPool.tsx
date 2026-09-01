import * as React from 'react';
import type { Player, Position } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ListPlus, Search } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { cn, formatSignedNumber } from '@/lib/utils';
import { useDraftStore } from '@/stores/draftStore';

type PositionFilter = Position | 'ALL' | 'FLEX';
const FLEX_POSITIONS: readonly Position[] = ['RB', 'WR', 'TE'];

function DraftPlayerRow({
  player,
  canDraft,
  showDraftAction,
  isQueued,
  rank,
  rankLabel,
  survivalProbability,
  onDraft,
  onToggleQueue,
}: {
  readonly player: Player;
  readonly canDraft: boolean;
  readonly showDraftAction: boolean;
  readonly isQueued: boolean;
  readonly rank: number;
  readonly rankLabel: string;
  readonly survivalProbability: number;
  readonly onDraft: (player: Player) => void;
  readonly onToggleQueue: (playerId: string) => void;
}): React.ReactElement {
  return (
    <article
      data-player-row
      className="grid grid-cols-[auto_minmax(150px,1.5fr)_auto_auto_auto] items-center gap-3 border-b border-border/55 px-3 py-2.5 hover:bg-muted/25"
    >
      <PlayerHeadshot
        playerId={player.id}
        name={player.name}
        position={player.position}
        className="size-10 rounded-full border border-border/70"
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{player.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
            {player.position}
          </Badge>
          <span>{player.team}</span>
          <span>·</span>
          <span>Bye {String(player.byeWeek)}</span>
        </div>
      </div>
      <div className="hidden text-right sm:block">
        <div className="font-mono text-xs font-semibold">#{String(rank)}</div>
        <div className="text-[10px] text-muted-foreground">{rankLabel}</div>
      </div>
      <div className="hidden min-w-[92px] text-right md:block">
        <div className="font-mono text-xs font-semibold">
          {formatSignedNumber(player.valueOverReplacement, 0)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          ECR #{String(player.ecrRank)} · T{String(player.tier)} · {String(Math.round(survivalProbability * 100))}% survives
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button
          variant={isQueued ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={isQueued ? `Remove ${player.name} from local shortlist` : `Add ${player.name} to local shortlist`}
          aria-pressed={isQueued}
          onClick={() => {
            onToggleQueue(player.id);
          }}
        >
          <ListPlus className="size-4" />
        </Button>
        {showDraftAction ? (
          <Button
            size="sm"
            disabled={!canDraft}
            onClick={() => {
              onDraft(player);
            }}
          >
            Draft
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function DraftPlayerPool(): React.ReactElement {
  const { players: basePlayers } = usePlayerDataQuery();
  const { output, overall } = useDraftDecision();
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const playerListRef = React.useRef<HTMLDivElement>(null);
  const deferredSearchQuery = React.useDeferredValue(searchQuery.trim().toLowerCase());
  const queuedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const { togglePlayerQueued } = useQueueActions(basePlayers);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const { canDraft, draftPlayer } = useDraftPlayerAction();
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const playerById = React.useMemo(
    () => new Map(basePlayers.map((player) => [player.id, player])),
    [basePlayers]
  );

  const recommendations = React.useMemo(() => overall.recommendations
    .filter((recommendation) => {
      const player = playerById.get(recommendation.playerId);
      if (!player) return false;
      if (positionFilter === 'FLEX' && !FLEX_POSITIONS.includes(player.position)) return false;
      if (positionFilter !== 'ALL' && positionFilter !== 'FLEX' && player.position !== positionFilter) return false;
      if (!deferredSearchQuery) return true;
      return player.name.toLowerCase().includes(deferredSearchQuery) ||
        player.team.toLowerCase().includes(deferredSearchQuery);
    })
    .slice(0, 60), [
      deferredSearchQuery,
      overall.recommendations,
      playerById,
      positionFilter,
    ]);
  const rankLabel = output.selectedLens === 'best-pick' ? 'Best Pick' : 'Best Player';
  const rowVirtualizer = useVirtualizer({
    count: recommendations.length,
    getScrollElement: () => playerListRef.current,
    estimateSize: () => 61,
    overscan: 10,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {(['ALL', 'FLEX', ...POSITIONS] as const).map((position) => (
            <Button
              key={position}
              variant={positionFilter === position ? 'default' : 'outline'}
              size="sm"
              className="min-w-11"
              aria-pressed={positionFilter === position}
              onClick={() => {
                setPositionFilter(position);
              }}
            >
              {position}
            </Button>
          ))}
        </div>
        <label className="relative block lg:w-72">
          <span className="sr-only">Search available players</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
            }}
            placeholder="Search players or teams"
            className="pl-9"
          />
        </label>
      </div>

      <div className={cn(
        'max-h-[310px] overflow-y-auto border-y border-border/70',
        recommendations.length === 0 && 'flex min-h-28 items-center justify-center'
      )} ref={playerListRef}>
        {recommendations.length > 0 ? (
          <div
            className="relative w-full"
            style={{ height: `${String(rowVirtualizer.getTotalSize())}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const recommendation = recommendations[virtualRow.index];
              if (!recommendation) return null;
              const player = playerById.get(recommendation.playerId);
              if (!player) return null;
              return (
                <div
                  key={player.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
                >
                  <DraftPlayerRow
                    player={player}
                    canDraft={canDraft}
                    showDraftAction={sessionMode === 'mock'}
                    isQueued={queuedSet.has(player.id)}
                    rank={overall.rankByPlayerId.get(player.id) ?? 0}
                    rankLabel={rankLabel}
                    survivalProbability={
                      recommendation.diagnostics?.nextPickSurvivalProbability
                        ?? player.nextPickSurvivalProbability
                    }
                    onDraft={draftPlayer}
                    onToggleQueue={togglePlayerQueued}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No available players match these filters.</p>
        )}
      </div>
    </div>
  );
}
