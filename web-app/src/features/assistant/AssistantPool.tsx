import * as React from 'react';
import { POSITIONS, type Position } from '@fantasy-draft/shared/league';
import type { PoolSort } from '@fantasy-draft/shared/draft';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { SUGGESTION_COUNT } from '@/features/draft-room/DraftSuggestions';
import { ProvisionalPickDialog } from '@/features/draft-room/ProvisionalPickDialog';
import { useSharedSuggestionActions } from '@/features/draft-room/SuggestionActionsContext';
import { isEditableTarget, moveActiveIndex } from '@/features/draft-room/pool-keyboard';
import { useSearchShortcut } from './useSearchShortcut';
import { useAssistantData } from './AssistantDataContext';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { getNextPickAvailability, type NextPickAvailability } from '@/lib/next-pick-availability';
import { useIdsInViewport } from '@/lib/use-in-viewport';
import { usePickFailureReporter, usePickLock } from '@/workspace/pick-in-flight';
import { getPositionRecommendations } from './assistant-position-rankings';
import { searchAvailablePlayers, sortPoolEntries, toPoolEntry, type PoolEntry } from './assistant-pool';
import { AssistantRecommendationRow, CandidateRowHeader, type PoolRowAction } from './AssistantRecommendationRow';

export type PositionFilter = 'ALL' | Position;

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', ...POSITIONS];
const UNESTIMATED: NextPickAvailability = { kind: 'unestimated' };
const NO_NEXT_PICK: NextPickAvailability = { kind: 'no-next-pick' };
const VISIBLE_ACTION = { fully: true, belowStickyHeader: true } as const;

/** The Assistant's player search, beside the cards it replaces while it has a query. `/` focuses it. */
export const AssistantSearch = React.forwardRef<HTMLInputElement, {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** ArrowDown from the box moves into the results. */
  readonly onArrowDown: () => void;
}>(function AssistantSearch({ value, onChange, onArrowDown }, ref): React.ReactElement {
  return (
    <label className="rec-search">
      <Search className="size-4" aria-hidden="true" />
      <span className="sr-only">Search all available players</span>
      <input ref={ref} value={value} onChange={(event) => { onChange(event.target.value); }} placeholder="Search player or team" aria-keyshortcuts="/"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) { event.preventDefault(); onChange(''); }
          if (event.key === 'ArrowDown' && !event.altKey && !event.metaKey && !event.ctrlKey) { event.preventDefault(); onArrowDown(); }
        }} />
      {value ? (
        <button type="button" className="rec-search-clear" aria-label="Clear search" onClick={() => { onChange(''); }}>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
});

export interface AssistantPoolProps {
  /** The raw query (for the heading), its deferred, trimmed, lower-cased form (for matching) and the search box. */
  readonly search: { readonly query: string; readonly deferredQuery: string; readonly ref: React.RefObject<HTMLInputElement> };
  readonly positionFilter: PositionFilter;
  readonly onPositionFilterChange: (filter: PositionFilter) => void;
  readonly sort: PoolSort;
  readonly onSortChange: (sort: PoolSort) => void;
  /** The rows the analysis describes, and what the highlight says. */
  readonly selection: { readonly highlightedPlayerIds: ReadonlySet<string>; readonly label: 'Viewing' | 'Comparing' };
  readonly collapsedCount: number;
  readonly onSelect: (playerId: string) => void;
}

/**
 * The compact best-available list under the suggestion cards, or the search results in their place. It complements
 * Position tiers rather than repeating it: one line per player with rank, position and team, the chance he is there
 * at your next pick, Draft and Queue. Search covers every available player, ranked or not. Page-wide draft data comes
 * from AssistantDataContext.
 */
export function AssistantPool({
  search, positionFilter, onPositionFilterChange, sort, onSortChange, selection, collapsedCount, onSelect,
}: AssistantPoolProps): React.ReactElement | null {
  const { query, deferredQuery, ref: searchRef } = search;
  const { highlightedPlayerIds, label: selectionLabel } = selection;
  const {
    overall, byPosition, recommendationById, playerById, available, availabilityById, finalPick, needs,
    rosterSize, totalRounds, mode, nextPickLabel, onQueue,
  } = useAssistantData();
  const [showAll, setShowAll] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  useSearchShortcut(searchRef);
  const position = positionFilter === 'ALL' ? null : positionFilter;
  const poolDecision = position === null ? overall : byPosition[position];

  const entries = React.useMemo((): readonly PoolEntry[] => {
    if (deferredQuery) {
      return sortPoolEntries(searchAvailablePlayers({ available, recommendationById, rankByPlayerId: overall.rankByPlayerId, query: deferredQuery, position }), sort);
    }
    const recommendations = position === null ? poolDecision.recommendations : getPositionRecommendations(poolDecision);
    return sortPoolEntries(recommendations.map((recommendation) => toPoolEntry(recommendation, playerById, overall.rankByPlayerId)), sort);
  }, [available, deferredQuery, overall.rankByPlayerId, playerById, poolDecision, position, recommendationById, sort]);

  // The cards already show the top four; the list starts after them unless it is searched, filtered or re-sorted.
  const skipsCardPlayers = position === null && sort === 'recommendation' && !deferredQuery;
  const listed = skipsCardPlayers ? entries.slice(SUGGESTION_COUNT) : entries;
  const shown = showAll ? listed : listed.slice(0, collapsedCount * 2);
  const hiddenCount = listed.length - shown.length;

  // One availability object per player, so a row's props only change when its own figure does.
  const rowAvailability = React.useMemo(() => new Map(shown.map((entry): [string, NextPickAvailability] => [
    entry.playerId,
    finalPick ? NO_NEXT_PICK : entry.recommendation?.diagnostics ? getNextPickAvailability(entry.recommendation.diagnostics) : availabilityById.get(entry.playerId) ?? UNESTIMATED,
  ])), [availabilityById, finalPick, shown]);

  const shownIds = React.useMemo(() => shown.map((entry) => entry.playerId), [shown]);
  const draft = useDraftPlayerAction('external');
  const lock = usePickLock();
  // A row shows its own failure only while its Draft/Retry is wholly on screen below the sticky header.
  const visibleIds = useIdsInViewport(listRef, 'data-pool-action', shownIds, shown.length > 0, VISIBLE_ACTION);
  usePickFailureReporter(lock, draft.origin, visibleIds);
  const shared = useSharedSuggestionActions();
  const [localRecord, setLocalRecord] = React.useState<string | null>(null);
  const { canDraft, canDraftPlayer, draftPlayer, draftStatus, pickInFlight } = draft;
  const rowAction = React.useCallback((entry: PoolEntry): PoolRowAction => {
    if (mode === 'mock') return canDraft && entry.player && canDraftPlayer(entry.player) ? 'draft' : null;
    return mode === 'manual-continuity' ? 'record' : null;
  }, [canDraft, canDraftPlayer, mode]);
  const onAction = React.useCallback((playerId: string, action: Exclude<PoolRowAction, null>) => {
    if (action === 'draft') {
      const player = playerById.get(playerId);
      if (player) draftPlayer(player);
      return;
    }
    if (shared) shared.setRecordPlayerId(playerId);
    else setLocalRecord(playerId);
  }, [draftPlayer, playerById, shared]);

  /** ↑↓, Page Up/Down, Home and End move between rows; ↑ from the first row returns to the search. */
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-pool-select]') ?? [])];
    const current = rows.findIndex((row) => row.closest('[data-pool-player]') === (event.target as HTMLElement).closest('[data-pool-player]'));
    if (event.key === 'Enter' && event.repeat) { event.preventDefault(); return; }
    if ((event.key === 'q' || event.key === 'Q') && current >= 0) {
      event.preventDefault();
      if (!event.repeat) onQueue(shown[current]?.playerId ?? '');
      return;
    }
    if (event.key === 'ArrowUp' && current === 0) { event.preventDefault(); searchRef.current?.focus(); return; }
    const next = moveActiveIndex(current < 0 ? null : current, event.key, rows.length);
    if (next === null) return;
    event.preventDefault();
    rows[next]?.focus();
  };

  if (overall.recommendations.length === 0 && !deferredQuery) return null;
  const heading = deferredQuery ? 'Search results' : position ? `Best available ${position}s` : 'Best available';
  return (
    <section className="rec-pool" aria-labelledby="rec-pool-heading">
      {/* One row: the heading, the position filter and the sort, so the first player sits as high as it can. */}
      <div className="rec-pool-toolbar">
        <h2 id="rec-pool-heading">{heading}</h2>
        {deferredQuery ? (
          <span className="rec-muted rec-pool-matches">
            {`${String(entries.length)} ${entries.length === 1 ? 'player matches' : 'players match'} “${query.trim()}” among all available${position ? ` ${position}s` : ' players'}.`}
          </span>
        ) : null}
        <div className="rec-filters" role="group" aria-label="Filter this list by position (the suggestions above stay overall)">
          {POSITION_FILTERS.map((filter) => {
            const need = filter === 'ALL' ? undefined : needs.find((item) => item.position === filter);
            const filled = filter === 'ALL' ? rosterSize : need?.startersFilled ?? 0;
            const total = filter === 'ALL' ? totalRounds : need?.startersNeeded ?? 0;
            return (
              <button key={filter} type="button" aria-pressed={positionFilter === filter}
                aria-label={`${filter === 'ALL' ? 'All' : filter}, ${String(filled)} of ${String(total)} filled`}
                onClick={() => { onPositionFilterChange(filter); setShowAll(false); }}>
                <span>{filter === 'ALL' ? 'All' : filter}</span>
                <small title="Roster spots filled">{String(filled)}/{String(total)}</small>
              </button>
            );
          })}
        </div>
        <div className="rec-sort">
          <span id="rec-pool-sort-label" className="sr-only">Sort</span>
          <Select aria-labelledby="rec-pool-sort-label" className="h-9 w-[128px] text-sm" value={sort}
            onValueChange={(value) => { onSortChange(value === 'tier' ? 'tier' : 'recommendation'); }}
            options={[{ value: 'recommendation', label: 'By rank' }, { value: 'tier', label: 'By tier' }]} />
        </div>
      </div>
      {shown.length > 0 ? (
        <div ref={listRef} className="rec-pool-list" onKeyDown={onListKeyDown}>
          <CandidateRowHeader nextPickLabel={finalPick ? null : nextPickLabel} />
          {shown.map((entry) => (
            <AssistantRecommendationRow
              key={entry.playerId}
              entry={entry}
              availability={rowAvailability.get(entry.playerId) ?? UNESTIMATED}
              isSelected={highlightedPlayerIds.has(entry.playerId)}
              selectionLabel={selectionLabel}
              action={rowAction(entry)}
              status={draftStatus?.playerId === entry.playerId ? draftStatus : undefined}
              pickInFlight={pickInFlight}
              onSelect={onSelect}
              onAction={onAction}
            />
          ))}
        </div>
      ) : (
        <div role="status" className="rec-empty">
          {deferredQuery ? 'No available players match your search and position filter.' : `No available ${position ? `${position} ` : ''}players.`}
        </div>
      )}
      {hiddenCount > 0 || showAll ? (
        <div className="rec-pool-more">
          <Button variant="outline" size="sm" aria-expanded={showAll} onClick={() => { setShowAll((current) => !current); }}>
            {showAll
              ? <><ChevronUp className="size-4" aria-hidden="true" /> Show fewer players</>
              : <><ChevronDown className="size-4" aria-hidden="true" /> Show {String(hiddenCount)} more players</>}
          </Button>
        </div>
      ) : null}
      {/* Only outside the workspace's shared suggestion actions, which mount the one Record dialog themselves. */}
      {localRecord ? <ProvisionalPickDialog open initialPlayerId={localRecord} onOpenChange={(open) => { if (!open) setLocalRecord(null); }} /> : null}
    </section>
  );
}
