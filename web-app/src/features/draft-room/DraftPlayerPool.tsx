import * as React from 'react';
import type { Player, Position } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ListPlus, Search } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MetricHelp } from '@/features/help/MetricHelp';
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
  rowIndex,
  survivalProbability,
  onDraft,
  onToggleQueue,
}: {
  readonly player: Player;
  readonly canDraft: boolean;
  readonly showDraftAction: boolean;
  readonly isQueued: boolean;
  readonly rank: number;
  readonly rowIndex: number;
  readonly survivalProbability: number;
  readonly onDraft: (player: Player) => void;
  readonly onToggleQueue: (playerId: string) => void;
}): React.ReactElement {
  return (
    <div role="row" aria-rowindex={rowIndex} data-player-row className="draft-pool-row draft-pool-columns">
      <div role="cell" className="draft-pool-player">
        <PlayerHeadshot playerId={player.id} name={player.name} position={player.position} className="size-9 shrink-0 rounded-full" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" title={player.name}>{player.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{player.position}</Badge>
            <span>{player.team}</span><span>·</span><span>Bye {String(player.byeWeek)}</span>
          </div>
        </div>
      </div>
      <div role="cell" className="draft-pool-number">#{String(rank)}</div>
      <div role="cell" className="draft-pool-number">{formatSignedNumber(player.valueOverReplacement, 0)}</div>
      <div role="cell" className="draft-pool-number">{String(Math.round(survivalProbability * 100))}%</div>
      <div role="cell" className="draft-pool-action">
        <Button variant={isQueued ? 'secondary' : 'ghost'} size="icon-sm"
          aria-label={isQueued ? `Remove ${player.name} from local shortlist` : `Add ${player.name} to local shortlist`}
          aria-pressed={isQueued} onClick={() => { onToggleQueue(player.id); }}>
          {isQueued ? <Check className="size-4" /> : <ListPlus className="size-4" />}
        </Button>
      </div>
      {showDraftAction ? (
        <div role="cell" className="draft-pool-action">
          <Button size="sm" disabled={!canDraft} aria-label={`Draft ${player.name}`} onClick={() => { onDraft(player); }}>Draft</Button>
        </div>
      ) : null}
    </div>
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
    getItemKey: (index) => recommendations[index]?.playerId ?? index,
    scrollMargin: 44,
    overscan: 10,
  });

  return (
    <div className="space-y-3">
      <div className="player-pool-toolbar">
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
        <label className="draft-player-search relative block">
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

      <div className="draft-pool-scroll" ref={playerListRef} tabIndex={0} role="region" aria-label="Available players, scroll for more">
        <div role="table" aria-label={`Available players ordered by ${rankLabel}`} aria-rowcount={recommendations.length + 1}
          className={cn('draft-pool-table', sessionMode === 'mock' && 'has-draft-action')}>
          <div role="rowgroup" className="draft-pool-heading">
            <div role="row" aria-rowindex={1} className="draft-pool-columns">
              <div role="columnheader">Player</div>
              <div role="columnheader"><MetricHelp metric="recommendationRank" label="Rank" context={<p>Ordered by {rankLabel}.</p>} /></div>
              <div role="columnheader"><MetricHelp metric="vor" label="Value" /></div>
              <div role="columnheader"><MetricHelp metric="returnProbability" label="Available next pick" /></div>
              <div role="columnheader">Queue</div>
              {sessionMode === 'mock' ? <div role="columnheader">Draft</div> : null}
            </div>
          </div>
          {recommendations.length > 0 ? (
            <div
              role="rowgroup"
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
                    style={{ transform: `translateY(${String(virtualRow.start - rowVirtualizer.options.scrollMargin)}px)` }}
                  >
                    <DraftPlayerRow
                      player={player}
                      canDraft={canDraft}
                      showDraftAction={sessionMode === 'mock'}
                      isQueued={queuedSet.has(player.id)}
                      rowIndex={virtualRow.index + 2}
                      rank={overall.rankByPlayerId.get(player.id) ?? 0}
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
            <div role="rowgroup"><div role="row"><div role="cell" aria-colspan={sessionMode === 'mock' ? 6 : 5} className="p-6 text-sm text-muted-foreground">No available players match these filters.</div></div></div>
          )}
        </div>
      </div>
    </div>
  );
}
