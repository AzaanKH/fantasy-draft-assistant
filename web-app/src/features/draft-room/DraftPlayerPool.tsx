import * as React from 'react';
import type { Player, Position, RosterRequirements } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ListPlus, Search } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PositionLabel } from '@/components/PositionLabel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MetricHelp } from '@/features/help/MetricHelp';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useUndraftedPlayers } from '@/hooks/useUndraftedPlayers';
import { cn, formatSignedNumber } from '@/lib/utils';
import { useDraftStore } from '@/stores/draftStore';
import { describePausedAdvice, getPlayerPoolRows, type PositionFilter } from './player-pool-rows';
import { getRosterSlots } from './roster-slots';

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

interface FilterCount {
  readonly filled: number;
  readonly target: number;
}

function getFilterLabel(position: PositionFilter): string {
  return position === 'ALL' ? 'All' : position;
}

/** Filled starter slots per filter, matching the roster sidebar; positions without starters show no count. */
function getFilterCounts(
  roster: Readonly<Record<Position, readonly string[]>>,
  requirements: RosterRequirements,
  totalRounds: number
): ReadonlyMap<PositionFilter, FilterCount> {
  const slots = getRosterSlots(roster, requirements);
  const counts = new Map<PositionFilter, FilterCount>([[
    'ALL',
    { filled: slots.filter((slot) => slot.playerId).length, target: totalRounds },
  ]]);
  for (const label of [...POSITIONS, 'FLEX'] as const) {
    const starterSlots = slots.filter((slot) => slot.label === label);
    if (starterSlots.length === 0) continue;
    counts.set(label, {
      filled: starterSlots.filter((slot) => slot.playerId).length,
      target: starterSlots.length,
    });
  }
  return counts;
}

function DraftPlayerRow({
  player,
  canDraft,
  positionFull,
  showDraftAction,
  isQueued,
  rank,
  rankLabel,
  rowIndex,
  survivalProbability,
  onDraft,
  onToggleQueue,
}: {
  readonly player: Player;
  readonly canDraft: boolean;
  /** The roster already holds the position's maximum. */
  readonly positionFull: boolean;
  readonly showDraftAction: boolean;
  readonly isQueued: boolean;
  readonly rank: number | undefined;
  readonly rankLabel: string;
  readonly rowIndex: number;
  readonly survivalProbability: number;
  readonly onDraft: (player: Player) => void;
  readonly onToggleQueue: (playerId: string) => void;
}): React.ReactElement {
  return (
    <div role="row" aria-rowindex={rowIndex} data-player-row className="draft-pool-row draft-pool-columns">
      {showDraftAction ? (
        <div role="cell" className="draft-pool-action">
          <Button size="sm" className="draft-pill-action" disabled={!canDraft || positionFull} title={canDraft && positionFull ? `${player.position} limit reached` : undefined} aria-label={`Draft ${player.name}`} onClick={() => { onDraft(player); }}>Draft</Button>
        </div>
      ) : null}
      <div role="cell" className="draft-pool-rank">
        {rank === undefined ? <span aria-label={`Not ranked by ${rankLabel}`}>–</span> : String(rank)}
      </div>
      <div role="cell" className="draft-pool-player">
        <PlayerHeadshot playerId={player.id} name={player.name} position={player.position} className="size-9 shrink-0 rounded-full" />
        <div className="min-w-0">
          <div className="draft-pool-name" title={player.name}>{player.name}</div>
          <div className="draft-pool-meta">
            <PositionLabel position={player.position} /> · {player.team} · Bye {String(player.byeWeek)}
          </div>
        </div>
      </div>
      <div role="cell" className="draft-pool-number">{formatSignedNumber(player.valueOverReplacement, 0)}</div>
      <div role="cell" className="draft-pool-number">{String(Math.round(survivalProbability * 100))}%</div>
      <div role="cell" className="draft-pool-action">
        <Button variant={isQueued ? 'secondary' : 'ghost'} size="icon-sm" className="rounded-sm"
          aria-label={isQueued ? `Remove ${player.name} from local shortlist` : `Add ${player.name} to local shortlist`}
          aria-pressed={isQueued} onClick={() => { onToggleQueue(player.id); }}>
          {isQueued ? <Check className="size-4" /> : <ListPlus className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

export function DraftPlayerPool(): React.ReactElement {
  const { players: basePlayers } = usePlayerDataQuery();
  const { output, overall, readiness, recommendationsBlocked, recommendationsBlockedByProviderIdentity } = useDraftDecision();
  const undraftedPlayers = useUndraftedPlayers();
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const playerListRef = React.useRef<HTMLDivElement>(null);
  const deferredSearchQuery = React.useDeferredValue(searchQuery.trim().toLowerCase());
  const queuedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const { togglePlayerQueued } = useQueueActions(basePlayers);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const myRoster = useDraftStore((state) => state.myRoster);
  const config = useDraftStore((state) => state.config);
  const { canDraft, canDraftPlayer, draftPlayer } = useDraftPlayerAction();
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);

  const rows = React.useMemo(
    () => getPlayerPoolRows(undraftedPlayers, overall.recommendations, positionFilter, deferredSearchQuery),
    [deferredSearchQuery, overall.recommendations, positionFilter, undraftedPlayers]
  );
  const filterCounts = React.useMemo(
    () => getFilterCounts(myRoster, config.rosterRequirements, config.totalRounds),
    [config.rosterRequirements, config.totalRounds, myRoster]
  );
  const rankLabel = output.selectedLens === 'best-pick' ? 'Best Pick' : 'Best Player';
  const orderLabel = recommendationsBlocked ? 'expert rank' : rankLabel;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => playerListRef.current,
    estimateSize: () => 61,
    getItemKey: (index) => rows[index]?.player.id ?? index,
    scrollMargin: 44,
    overscan: 10,
  });

  return (
    <div className="draft-pool">
      <div className="player-pool-toolbar">
        <div className="draft-position-filters" role="group" aria-label="Filter by position">
          {POSITION_FILTERS.map((position) => {
            const count = filterCounts.get(position);
            return (
              <button
                key={position}
                type="button"
                className="draft-position-filter"
                aria-pressed={positionFilter === position}
                aria-label={count ? `${getFilterLabel(position)}, ${count.filled} of ${count.target} filled` : getFilterLabel(position)}
                onClick={() => {
                  setPositionFilter(position);
                }}
              >
                <span>{getFilterLabel(position)}</span>
                {count ? <small aria-hidden="true">{String(count.filled)} / {String(count.target)}</small> : null}
              </button>
            );
          })}
        </div>
        <label className="draft-player-search relative block">
          <span className="sr-only">Search available players</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
            }}
            placeholder="Search player or team"
            className="draft-search-input pl-9"
          />
        </label>
      </div>

      {recommendationsBlocked ? (
        <p className="draft-pool-paused" role="status">{describePausedAdvice(readiness, recommendationsBlockedByProviderIdentity)}</p>
      ) : null}
      <div className="draft-pool-scroll" ref={playerListRef} tabIndex={0} role="region" aria-label="Available players, scroll for more">
        <div role="table" aria-label={`Available players ordered by ${orderLabel}`} aria-rowcount={rows.length + 1}
          className={cn('draft-pool-table', sessionMode === 'mock' && 'has-draft-action')}>
          <div role="rowgroup" className="draft-pool-heading">
            <div role="row" aria-rowindex={1} className="draft-pool-columns">
              {sessionMode === 'mock' ? <div role="columnheader"><span className="sr-only">Draft</span></div> : null}
              <div role="columnheader"><MetricHelp metric="recommendationRank" label="Rank" context={<p>Ordered by {orderLabel}.</p>} /></div>
              <div role="columnheader">Player</div>
              <div role="columnheader"><MetricHelp metric="vor" label="Value" /></div>
              <div role="columnheader"><MetricHelp metric="returnProbability" label="Available next pick" /></div>
              <div role="columnheader">Queue</div>
            </div>
          </div>
          {rows.length > 0 ? (
            <div
              role="rowgroup"
              className="relative w-full"
              style={{ height: `${String(rowVirtualizer.getTotalSize())}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const { player, recommendation } = row;
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
                      positionFull={canDraft && !canDraftPlayer(player)}
                      showDraftAction={sessionMode === 'mock'}
                      isQueued={queuedSet.has(player.id)}
                      rowIndex={virtualRow.index + 2}
                      rank={overall.rankByPlayerId.get(player.id)}
                      rankLabel={rankLabel}
                      survivalProbability={
                        recommendation?.diagnostics?.nextPickSurvivalProbability
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
      <div className="draft-pool-footer">
        <span>
          {sessionMode === 'mock' && !canDraft
            ? 'Draft actions are unavailable until your pick.'
            : `${String(rows.length)} players shown`}
        </span>
        <span>Ordered by {orderLabel}</span>
      </div>
    </div>
  );
}
