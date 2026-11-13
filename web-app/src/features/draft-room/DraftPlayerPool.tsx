import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { RANKING_LABELS } from '@/lib/demo-mode';
import * as React from 'react';
import {
  type Position,
  KICKER_DEFENSE_POSITIONS,
  OFFENSIVE_POSITIONS,
  POSITIONS,
} from '@fantasy-draft/shared/league';
import {
  type RosterRequirements,
} from '@fantasy-draft/shared/league';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { countAvailableByTier, tierKey } from '@/features/assistant/assistant-tiers';
import { MetricHelp } from '@/features/help/MetricHelp';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { usePickFailureReporter, usePickLock } from '@/workspace/pick-in-flight';
import { LAYOUT_TOKENS, useLayoutPx } from '@/lib/layout-tokens';
import { fullyVisibleItems } from '@/lib/use-in-viewport';
import { getNextPickAvailability, type NextPickAvailability } from '@/lib/next-pick-availability';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useUndraftedPlayers } from '@/hooks/useUndraftedPlayers';
import { cn } from '@/lib/utils';
import { useLiveDraftSync } from './LiveDraftSyncProvider';
import { describePausedAdvice, getPlayerPoolRows, type PositionFilter } from './player-pool-rows';
import { DraftPlayerPoolRow, DraftPlayerRowPlaceholder, OPTIONAL_POOL_COLUMNS } from './DraftPlayerPoolRow';
import { POOL_ACTIVE_HINT_ID, usePoolKeyboard } from './usePoolKeyboard';
import { useDraftSessionKey, useLandedPick, useLeavingPoolRow } from './usePickLanded';
import { ProvisionalPickDialog } from './ProvisionalPickDialog';
import { getRosterSlots } from './roster-slots';

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', ...OFFENSIVE_POSITIONS, 'FLEX', ...KICKER_DEFENSE_POSITIONS];

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

/** Fills the pool's scroll area while player data loads; the area's height is fixed, so the count only needs to cover it. */
const PLACEHOLDER_ROW_COUNT = 10;
/** Fallbacks where styles are unavailable; the real row and heading heights are CSS tokens (lib/layout-tokens.ts). */
const POOL_ROW_FALLBACK = 46;
const POOL_HEADING_FALLBACK = 36;

export { PlayerLinesPlaceholder } from './DraftPlayerPoolRow';

/** React 18 has no `inert` prop; the leaving ghost row must not take focus or clicks. */
function makeInert(element: HTMLElement | null): void {
  element?.setAttribute('inert', '');
}

/** The pool footer's status line, most urgent first: loading, this pool's failed Draft, a saving pick, a mock waiting for the user's turn, then the count. */
export function poolFooterMessage({ isLoading, failure, pickInFlight, mockWaiting, shown }: {
  readonly isLoading: boolean;
  readonly failure: string | null;
  readonly pickInFlight: boolean;
  readonly mockWaiting: boolean;
  readonly shown: number;
}): { readonly text: string; readonly tone: 'danger' | 'muted' } {
  if (isLoading) return { text: 'Loading players…', tone: 'muted' };
  if (failure !== null) return { text: failure, tone: 'danger' };
  if (pickInFlight) return { text: 'Saving pick…', tone: 'muted' };
  if (mockWaiting) return { text: 'Draft actions are unavailable until your pick.', tone: 'muted' };
  return { text: `${String(shown)} players shown`, tone: 'muted' };
}

const UNESTIMATED_AVAILABILITY: NextPickAvailability = { kind: 'unestimated' };

/** Columns every pool shows, whatever the mode or width: Rank, Player, Proj, Value, Available next pick, Queue. */
const FIXED_POOL_COLUMN_COUNT = 6;

export function DraftPlayerPool({ onRevealRequest, heading, toolbarEnd }: {
  /** Opens the collapsed dock so the search shortcut can focus search. */
  readonly onRevealRequest?: () => void;
  /** Title shown at the start of the toolbar row (the split dock has no separate heading row). */
  readonly heading?: React.ReactNode;
  /** Shown at the end of the toolbar row, such as the dock's collapse toggle. */
  readonly toolbarEnd?: React.ReactNode;
}): React.ReactElement {
  const { players: basePlayers, isLoading } = usePlayerDataQuery();
  const { output, overall, readiness, recommendationsBlocked, recommendationsBlockedByProviderIdentity, nextPickAvailabilityById } = useDraftDecision();
  const undraftedPlayers = useUndraftedPlayers();
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const deferredSearchQuery = React.useDeferredValue(searchQuery.trim().toLowerCase());
  const queuedPlayerIds = useDraftView((view) => view.shortlistedPlayerIds);
  const { togglePlayerQueued, addPlayerToQueue } = useQueueActions(basePlayers);
  const sessionMode = useDraftState((state) => state.sessionMode);
  const myRoster = useDraftView((view) => view.myRoster);
  const config = useDraftState((state) => state.config);
  // The pool registers its own reporter below, for the rows actually in view.
  const pickLock = usePickLock();
  const { canDraft: canDraftNow, canDraftPlayer, draftPlayer, draftStatus, pickInFlight, origin: pickOrigin } = useDraftPlayerAction('external');
  // While any pick saves, every Draft control and keyboard drafting waits for it.
  const canDraft = canDraftNow && !pickInFlight;
  const { synchronizationState } = useLiveDraftSync();
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const [recordPlayerId, setRecordPlayerId] = React.useState<string | null>(null);

  const rows = React.useMemo(
    () => getPlayerPoolRows(undraftedPlayers, overall.recommendations, positionFilter, deferredSearchQuery, config.rosterRequirements),
    [config.rosterRequirements, deferredSearchQuery, overall.recommendations, positionFilter, undraftedPlayers]
  );
  const tierCounts = React.useMemo(() => countAvailableByTier(undraftedPlayers), [undraftedPlayers]);
  const filterCounts = React.useMemo(
    () => getFilterCounts(myRoster, config.rosterRequirements, config.totalRounds),
    [config.rosterRequirements, config.totalRounds, myRoster]
  );
  const rankLabel = output.selectedLens === 'best-pick' ? 'Best Pick' : 'Best Player';
  const orderLabel = recommendationsBlocked
    ? RANKING_LABELS.long
    : `${rankLabel} for recommended players, then ${RANKING_LABELS.long}`;
  const playerListRef = React.useRef<HTMLDivElement | null>(null);
  const poolSizes = {
    row: useLayoutPx(LAYOUT_TOKENS.poolRowHeight, POOL_ROW_FALLBACK),
    heading: useLayoutPx(LAYOUT_TOKENS.poolHeadingHeight, POOL_HEADING_FALLBACK),
  };
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => playerListRef.current,
    estimateSize: () => poolSizes.row,
    getItemKey: (index) => rows[index]?.player.id ?? index,
    scrollMargin: poolSizes.heading,
    overscan: 10,
  });
  // Last rendered offset of each visible row, so a drafted row can fade out where it was.
  const rowStarts = React.useRef<ReadonlyMap<string, number>>(new Map());
  const draftedPlayerIds = useDraftView((view) => view.draftedPlayerIds);
  const landedPick = useLandedPick(useDraftState((state) => state.draftHistory), useDraftSessionKey());
  const leavingRow = useLeavingPoolRow({ rows, starts: rowStarts.current, draftedPlayerIds, landedPlayerId: landedPick?.playerId ?? null, availabilityById: nextPickAvailabilityById });
  const keyboard = usePoolKeyboard({
    rows,
    sessionMode,
    // Resolved without the pick lock so Enter never falls back to queueing while a pick saves; draftPlayer
    // ignores the key while locked, and Record waits for the save.
    canDraftPlayer: (player) => canDraftNow && canDraftPlayer(player),
    canRecordProvisional: sessionMode === 'live' && synchronizationState === 'manual-continuity',
    isQueued: (playerId) => queuedSet.has(playerId),
    onDraft: draftPlayer,
    onRecord: (playerId) => { if (!pickInFlight) setRecordPlayerId(playerId); },
    onAddToQueue: addPlayerToQueue,
    onToggleQueue: togglePlayerQueued,
    scrollToIndex: (index) => { rowVirtualizer.scrollToIndex(index, { align: 'auto' }); },
    onRevealRequest,
  });
  const setListRef = React.useCallback((element: HTMLDivElement | null) => {
    playerListRef.current = element;
    keyboard.listRef.current = element;
  }, [keyboard.listRef]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  // A failed row shows its own Retry only while it is in view: overscan rows and rows scrolled away hand the failure
  // to the workspace notice, which keeps a visible recovery action. The footer repeats only what a visible row shows.
  // Only rows wholly in view count: a row half under the sticky column heading, or cut at the bottom edge, has a
  // Retry nobody can reach. Without a measured scroller (tests) the virtualizer's own range stands in.
  const visibleStart = rowVirtualizer.range?.startIndex ?? 0;
  const visibleEnd = rowVirtualizer.range?.endIndex ?? -1;
  const scrollOffset = rowVirtualizer.scrollOffset ?? 0;
  const viewportHeight = rowVirtualizer.scrollRect?.height ?? 0;
  const fullyVisibleKey = viewportHeight > 0
    ? fullyVisibleItems(virtualRows, { scrollOffset, viewportHeight, stickyTop: poolSizes.heading }).map((item) => item.index).join(',')
    : null;
  const visiblePlayerIds = React.useMemo(
    () => fullyVisibleKey === null
      ? rows.slice(visibleStart, visibleEnd + 1).map((row) => row.player.id)
      : fullyVisibleKey.split(',').flatMap((index) => index === '' ? [] : [rows[Number(index)]?.player.id ?? '']).filter(Boolean),
    [fullyVisibleKey, rows, visibleStart, visibleEnd]
  );
  usePickFailureReporter(pickLock, pickOrigin, visiblePlayerIds);
  const shownFailure = draftStatus?.state === 'failed' && visiblePlayerIds.includes(draftStatus.playerId) ? draftStatus.message : null;
  // "id@start|…" for the rendered rows: the offsets are rebuilt only when it changes, not on every render.
  const renderedRowsKey = virtualRows.map((item) => `${rows[item.index]?.player.id ?? ''}@${String(item.start)}`).join('|');
  React.useEffect(() => {
    rowStarts.current = new Map(renderedRowsKey.split('|').flatMap((entry) => {
      const at = entry.lastIndexOf('@');
      const id = entry.slice(0, at);
      return id ? [[id, Number(entry.slice(at + 1))] as const] : [];
    }));
  }, [renderedRowsKey]);
  // Only point at a row that is rendered; the highlight scrolls its row into the virtual window.
  const activeDescendant = keyboard.activePlayerId !== null && virtualRows.some((item) => rows[item.index]?.player.id === keyboard.activePlayerId)
    ? keyboard.activeDescendantId
    : undefined;
  // Rank, Player, Proj, Value, Available next pick and Queue, the optional columns, and Draft in a mock.
  const columnCount = (sessionMode === 'mock' ? 1 : 0) + FIXED_POOL_COLUMN_COUNT + OPTIONAL_POOL_COLUMNS.length;

  return (
    <div className="draft-pool">
      <div className="player-pool-toolbar" data-has-heading={heading ? '' : undefined}>
        {heading}
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
            ref={keyboard.searchRef}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              keyboard.clearHighlight();
            }}
            onKeyDown={keyboard.onSearchKeyDown}
            placeholder="Search player or team"
            aria-keyshortcuts="/ Control+K Meta+K"
            aria-describedby="draft-pool-shortcuts"
            className="draft-search-input pl-9 pr-9"
          />
          <kbd className="draft-search-kbd" aria-hidden="true">/</kbd>
        </label>
        {toolbarEnd ? <div className="draft-pool-toolbar-end">{toolbarEnd}</div> : null}
      </div>

      {recommendationsBlocked && !isLoading ? (
        <p className="draft-pool-paused" role="status">{describePausedAdvice(readiness, recommendationsBlockedByProviderIdentity)}</p>
      ) : null}
      {/* The focusable scroller is the grid itself, so aria-activedescendant (the highlighted row's player cell)
          sits on the element that owns the rows. */}
      <div className="draft-pool-scroll" ref={setListRef} tabIndex={0} role="grid" aria-readonly="true"
        aria-label={`Available players ordered by ${orderLabel}, scroll for more`} aria-rowcount={rows.length + 1} aria-colcount={columnCount}
        aria-describedby="draft-pool-shortcuts" aria-activedescendant={activeDescendant} onKeyDown={keyboard.onListKeyDown}>
        <div className={cn('draft-pool-table', sessionMode === 'mock' && 'has-draft-action')}>
          <div role="rowgroup" className="draft-pool-heading">
            <div role="row" aria-rowindex={1} className="draft-pool-columns">
              {sessionMode === 'mock' ? <div role="columnheader"><span className="sr-only">Draft</span></div> : null}
              <div role="columnheader"><MetricHelp metric="recommendationRank" label="Rank" context={<p>Ordered by {orderLabel}.</p>} /></div>
              <div role="columnheader">Player</div>
              <div role="columnheader" data-col="pos" className="draft-pool-extra draft-pool-number"><abbr title="Position rank" className="no-underline">Pos</abbr></div>
              <div role="columnheader" data-col="adp" className="draft-pool-extra draft-pool-number"><abbr title="Average draft position" className="no-underline">ADP</abbr></div>
              <div role="columnheader" data-col="bye" className="draft-pool-extra draft-pool-number">Bye</div>
              <div role="columnheader" data-col="inj" className="draft-pool-extra draft-pool-status"><abbr title="Injury designation" className="no-underline">Inj</abbr></div>
              <div role="columnheader" data-col="vsadp" className="draft-pool-extra draft-pool-number"><abbr title="Value versus ADP: ADP minus expert rank. Positive means the market drafts the player later than experts rank them." className="no-underline">vs ADP</abbr></div>
              <div role="columnheader" data-col="proj" className="draft-pool-number"><MetricHelp metric="projectedPoints" label="Proj" /></div>
              <div role="columnheader"><MetricHelp metric="vor" label="Value" /></div>
              <div role="columnheader"><MetricHelp metric="returnProbability" label="Available next pick" /></div>
              <div role="columnheader">Queue</div>
            </div>
          </div>
          {isLoading ? (
            <div role="rowgroup">
              {Array.from({ length: PLACEHOLDER_ROW_COUNT }, (_, index) => (
                <DraftPlayerRowPlaceholder key={index} showDraftAction={sessionMode === 'mock'} />
              ))}
            </div>
          ) : rows.length > 0 ? (
            <div
              role="rowgroup"
              className="draft-pool-rows relative w-full"
              data-settling={leavingRow ? '' : undefined}
              style={{ height: `${String(rowVirtualizer.getTotalSize())}px` }}
            >
              {leavingRow ? (
                // The drafted row fades and collapses in place while the rows below slide up (transform and opacity only).
                <div aria-hidden="true" ref={makeInert} className="draft-pool-row-leaving absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${String(leavingRow.start - rowVirtualizer.options.scrollMargin)}px)` }}>
                  <DraftPlayerPoolRow
                    player={leavingRow.player}
                    canDraft={false}
                    positionFull={false}
                    showDraftAction={sessionMode === 'mock'}
                    isQueued={false}
                    rowIndex={-1}
                    rank={undefined}
                    rankLabel={rankLabel}
                    availability={leavingRow.availability}
                    tierRemaining={undefined}
                    draftStatus={undefined}
                    isActive={false}
                    onDraft={draftPlayer}
                    onToggleQueue={togglePlayerQueued}
                  />
                </div>
              ) : null}
              {virtualRows.map((virtualRow) => {
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
                    <DraftPlayerPoolRow
                      player={player}
                      canDraft={canDraft}
                      positionFull={canDraftNow && !canDraftPlayer(player)}
                      showDraftAction={sessionMode === 'mock'}
                      isQueued={queuedSet.has(player.id)}
                      rowIndex={virtualRow.index + 2}
                      rank={recommendation ? overall.rankByPlayerId.get(player.id) : player.ecrRank}
                      rankLabel={recommendation ? rankLabel : RANKING_LABELS.long}
                      // The model's estimate for this pick (the recommendation's own, else the league-adjusted pool's),
                      // never the catalog's static figure; the final pick has no later pick to estimate.
                      availability={recommendation?.diagnostics
                        ? getNextPickAvailability(recommendation.diagnostics)
                        : nextPickAvailabilityById.get(player.id) ?? UNESTIMATED_AVAILABILITY}
                      tierRemaining={tierCounts.get(tierKey(player.position, player.tier))}
                      draftStatus={draftStatus?.playerId === player.id ? draftStatus : undefined}
                      isActive={player.id === keyboard.activePlayerId}
                      onDraft={draftPlayer}
                      onToggleQueue={togglePlayerQueued}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div role="rowgroup"><div role="row"><div role="gridcell" aria-colspan={columnCount} className="p-6 text-sm text-muted-foreground">No available players match these filters.</div></div></div>
          )}
        </div>
      </div>
      <div className="draft-pool-footer" data-failed={shownFailure !== null || undefined}>
        <span>
          {(() => {
            const footer = poolFooterMessage({ isLoading, failure: shownFailure, pickInFlight, mockWaiting: sessionMode === 'mock' && !canDraft, shown: rows.length });
            return footer.tone === 'danger' ? <span className="text-danger">{footer.text}</span> : footer.text;
          })()}
        </span>
        <span id="draft-pool-shortcuts" className="draft-pool-shortcuts">
          <kbd>/</kbd> search · <kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> {keyboard.enterHint} · <kbd>Q</kbd> add or remove from queue
        </span>
        <span className="draft-pool-order" title={`Ordered by ${orderLabel}`}>Ordered by {orderLabel}</span>
      </div>
      <p className="sr-only" aria-live="polite">{keyboard.announcement}</p>
      <span id={POOL_ACTIVE_HINT_ID} hidden>{keyboard.activeHint}</span>
      {recordPlayerId ? (
        <ProvisionalPickDialog
          open
          initialPlayerId={recordPlayerId}
          onOpenChange={(open) => { if (!open) setRecordPlayerId(null); }}
        />
      ) : null}
    </div>
  );
}
