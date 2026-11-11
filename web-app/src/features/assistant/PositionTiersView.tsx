import { IS_DEMO, RANKING_LABELS } from '@/lib/demo-mode';
import { StatusChip } from '@/components/InjuryTag';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getInjuryTag } from '@/lib/player-status';
import { getPlayerRisk } from '@/lib/player-risk';
import { PositionTag } from '@/components/PositionTag';
import { OFFENSIVE_POSITIONS, POSITIONS, type Player, type Position } from '@fantasy-draft/shared/league';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { ArrowLeft, ArrowRight, Check, Plus, Search, X } from 'lucide-react';
import * as React from 'react';
import { describeMissingAvailability, formatAvailabilityPercent, getNextPickAvailability, type NextPickAvailability } from '@/lib/next-pick-availability';
import { useAssistantData } from './AssistantDataContext';
import { useSearchShortcut } from './useSearchShortcut';
import { buildOverallBands, buildPositionTiers, isTierDepleted, type OverallBand, type TierGroup, type TierPlayer } from './assistant-tiers';

type TierFilter = 'ALL' | Position;

const FILTERS: readonly TierFilter[] = ['ALL', ...POSITIONS];
const DEFAULT_POSITIONS: readonly Position[] = OFFENSIVE_POSITIONS;
const POSITION_NAMES: Readonly<Record<Position, string>> = {
  QB: 'Quarterbacks', RB: 'Running backs', WR: 'Wide receivers', TE: 'Tight ends', K: 'Kickers', DEF: 'Defenses',
};
/** Players shown per column, across its tiers, before "Show more": a full cheat-sheet screen of compact rows. */
const VISIBLE_PLAYERS_PER_COLUMN = 20;
/**
 * "Show more" adds this many rows per press. A column can hold 300+ players, so expanding never renders the whole
 * list at once; a search starts with one extra page so its matches usually show without a press.
 */
export const TIER_PAGE_SIZE = 40;

/** Rows a column shows for its page count; searching starts one page deeper. */
export function getTierColumnBudget(pages: number, searching: boolean): number {
  return VISIBLE_PLAYERS_PER_COLUMN + (pages + (searching ? 1 : 0)) * TIER_PAGE_SIZE;
}

/** One cheat-sheet column: Overall (round-sized bands of the expert order) or a position's tiers. */
interface TierColumn {
  readonly key: 'OVERALL' | Position;
  readonly position: Position | null;
  readonly activeTier: number | null;
  readonly exhaustedTiers: readonly number[];
  readonly groups: readonly (TierGroup | OverallBand)[];
}

function groupTitle(group: TierGroup | OverallBand): string {
  return 'label' in group ? group.label : `Tier ${String(group.tier)}`;
}

/**
 * Tier rows are numbered by the source ranking they are grouped and ordered by (FantasyPros ECR live), not by the
 * model's overall order the cards and lists use. Renumbering them by model rank would make each tier read out of
 * order, so the number is labelled as the source rank instead: a column header plus each row's spoken text.
 */
export const TIER_RANK_HEADER = IS_DEMO ? 'Rank' : 'ECR';
const tierRankText = (rank: number): string => `${RANKING_LABELS.title} ${String(rank)}`;

const UNESTIMATED: NextPickAvailability = { kind: 'unestimated' };
const NO_NEXT_PICK: NextPickAvailability = { kind: 'no-next-pick' };

/**
 * A row's next-pick figure, from the same sources as the draft room's pool: the analysis's own estimate, then the
 * survival model's figure for every available player (rows beyond the shortlist included), and "Final" for every
 * row on the manager's last pick.
 */
export function getTierRowAvailability(
  playerId: string,
  recommendation: Recommendation | undefined,
  availabilityById: ReadonlyMap<string, NextPickAvailability>,
  finalPick: boolean
): NextPickAvailability {
  if (finalPick) return NO_NEXT_PICK;
  return recommendation?.diagnostics ? getNextPickAvailability(recommendation.diagnostics) : availabilityById.get(playerId) ?? UNESTIMATED;
}

const TierRow = React.memo(function TierRow({
  player,
  detail,
  drafted,
  draftedPickLabel,
  availability,
  isBestPick,
  isSelected,
  isQueued,
  nextPickLabel,
  showPosition,
  onSelect,
  onQueue,
}: {
  readonly player: TierPlayer;
  /** The full catalog player, for injury and risk. */
  readonly detail?: Player;
  readonly drafted: boolean;
  /** "1.05 · Team 6" for picks recorded in the draft history; keepers and unrecorded picks have none. */
  readonly draftedPickLabel: string | undefined;
  readonly availability: NextPickAvailability;
  readonly isBestPick: boolean;
  readonly isSelected: boolean;
  readonly isQueued: boolean;
  readonly nextPickLabel: string | null;
  /** Overall bands mix positions, so their rows name the position. */
  readonly showPosition: boolean;
  readonly onSelect: (playerId: string, origin: HTMLElement) => void;
  readonly onQueue: (playerId: string) => void;
}): React.ReactElement {
  const flag = getTierFlag(detail, drafted);
  // Unique per row: a player can be listed in both the Overall band and their position column.
  const flagId = React.useId();
  const description = [
    tierRankText(player.ecrRank),
    player.team,
    drafted ? (draftedPickLabel ? `Drafted ${draftedPickLabel}` : 'Drafted') : null,
    isBestPick ? 'Best Pick' : null,
    isSelected ? 'Viewing' : null,
  ].filter(Boolean).join(', ');
  return (
    <li className="rec-tier-row" data-drafted={drafted} data-selected={isSelected} data-best={isBestPick || undefined} data-tier-player-id={player.id}>
      <span className="rec-candidate-rank" title={tierRankText(player.ecrRank)}>
        <span aria-hidden="true">{String(player.ecrRank)}</span>
        <span className="sr-only">{tierRankText(player.ecrRank)}</span>
      </span>
      <TierIdentityButton flagDetail={flag?.detail} flagId={flagId} disabled={drafted} onClick={(event) => { onSelect(player.id, event.currentTarget); }}>
        {showPosition ? <PositionTag position={player.position} /> : null}
        <span className="rec-candidate-name" title={player.name}>{player.name}</span>
        <span className="rec-tier-team" aria-hidden="true">{player.team}</span>
        {isBestPick ? <span className="rec-accent" aria-hidden="true">Best</span> : null}
        <span className="sr-only">, {description}</span>
      </TierIdentityButton>
      <TierFlag flag={flag} id={flagId} />
      {drafted ? <span className="rec-muted rec-tier-taken" title={draftedPickLabel ? `Drafted at ${draftedPickLabel}` : 'Drafted'}>{draftedPickLabel ?? 'Taken'}</span> : (
        <>
          <TierAvailability availability={availability} nextPickLabel={nextPickLabel} />
          <button
            type="button"
            className="rec-icon-button rec-queue-toggle"
            aria-pressed={isQueued}
            aria-label={`${isQueued ? 'Remove' : 'Add'} ${player.name} ${isQueued ? 'from' : 'to'} queue`}
            onClick={() => { onQueue(player.id); }}
          >
            {isQueued ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          </button>
        </>
      )}
    </li>
  );
});

/** Short stand-ins that fit the 30px column; the full label is the title and the accessible text. */
const SHORT_MISSING: Readonly<Record<Exclude<NextPickAvailability['kind'], 'estimate'>, string>> = { 'no-next-pick': 'Final', unestimated: 'N/A' };

function TierAvailability({ availability, nextPickLabel }: { readonly availability: NextPickAvailability; readonly nextPickLabel: string | null }): React.ReactElement {
  if (availability.kind === 'estimate') {
    return <span className="rec-candidate-value" title={`Chance still available at ${nextPickLabel ?? 'your next pick'}`}>{formatAvailabilityPercent(availability)}</span>;
  }
  const label = describeMissingAvailability(availability) ?? '';
  return (
    <span className="rec-candidate-value" title={label}>
      <span className="rec-unknown rec-tier-missing" aria-hidden="true">{SHORT_MISSING[availability.kind]}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface TierFlagInfo {
  readonly label: string;
  readonly tone: 'neutral' | 'ok' | 'warn' | 'bad';
  /** Injury and risk in plain words: the row control's accessible description and its focus tooltip. */
  readonly detail: string;
}

/** An injury designation wins the one flag slot, then elevated risk; both stay in the detail when they combine. */
function getTierFlag(detail: Player | undefined, drafted: boolean): TierFlagInfo | null {
  const injury = detail ? getInjuryTag(detail.newsStatus) : null;
  const risk = detail && !drafted ? getPlayerRisk(detail) : null;
  const elevatedRisk = risk && risk.level !== 'low' ? risk : null;
  if (!injury && !elevatedRisk) return null;
  return {
    label: `${injury ? injury.abbreviation : '!'}${injury && elevatedRisk ? '+' : ''}`,
    tone: injury ? injury.tone : elevatedRisk?.level === 'high' ? 'bad' : 'warn',
    detail: [injury?.label, elevatedRisk?.detail].filter(Boolean).join('. '),
  };
}

/**
 * The row's one focusable control (it selects the player). A flagged row's injury and risk details are its
 * accessible description and a tooltip on focus or hover, so a keyboard user reads them without a tab stop per chip.
 */
function TierIdentityButton({ flagDetail, flagId, disabled, onClick, children }: {
  readonly flagDetail: string | undefined;
  readonly flagId: string;
  readonly disabled: boolean;
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const button = (
    <button type="button" className="rec-tier-identity" disabled={disabled} aria-describedby={flagDetail ? flagId : undefined} onClick={onClick}>
      {children}
    </button>
  );
  if (!flagDetail || disabled) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" aria-hidden="true">{flagDetail}</TooltipContent>
    </Tooltip>
  );
}

/** One compact flag per row so the name keeps its width; its detail text is the identity button's description. */
function TierFlag({ flag, id }: { readonly flag: TierFlagInfo | null; readonly id: string }): React.ReactElement {
  if (!flag) return <span className="rec-tier-flags" />;
  return (
    <span className="rec-tier-flags">
      <StatusChip tone={flag.tone} title={flag.detail}>
        <span aria-hidden="true">{flag.label}</span>
        <span id={id} className="sr-only">{flag.detail}</span>
      </StatusChip>
    </span>
  );
}

/** Which sides of the cheat sheet have columns scrolled out of view. */
interface ColumnOverflow { readonly start: boolean; readonly end: boolean }
const NO_OVERFLOW: ColumnOverflow = { start: false, end: false };

/**
 * Which sides of the cheat sheet's scroller have columns out of view. Measured on scroll, when the scroller or any
 * column resizes, and whenever `contentKey` changes (filter, search, Show drafted, paging), because new content can
 * widen or narrow the sheet without resizing the scroller's own box.
 */
function useColumnOverflow(ref: React.RefObject<HTMLDivElement>, contentKey: string): ColumnOverflow {
  const [overflow, setOverflow] = React.useState<ColumnOverflow>(NO_OVERFLOW);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) { setOverflow(NO_OVERFLOW); return; }
    const measure = (): void => {
      const max = element.scrollWidth - element.clientWidth;
      const next = { start: max > 1 && element.scrollLeft > 1, end: max > 1 && element.scrollLeft < max - 1 };
      setOverflow((current) => current.start === next.start && current.end === next.end ? current : next);
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    for (const column of element.children) observer?.observe(column);
    return () => { element.removeEventListener('scroll', measure); observer?.disconnect(); };
  }, [contentKey, ref]);
  return overflow;
}

/**
 * The cheat sheet's columns. When they are wider than the sheet (all five beside the analysis on a laptop), the
 * hidden side fades; the "Earlier / More columns" controls live in the toolbar row (TierScrollCues), never over a
 * column heading. The sheet also still scrolls with a trackpad, wheel or keyboard.
 */
function TierColumns({ scrollerRef, overflow, count, hasOverall, children }: {
  readonly scrollerRef: React.RefObject<HTMLDivElement>;
  readonly overflow: ColumnOverflow;
  /** Columns actually rendered; the sheet declares exactly this many tracks. */
  readonly count: number;
  readonly hasOverall: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rec-tier-scroll" data-overflow-start={overflow.start || undefined} data-overflow-end={overflow.end || undefined}>
      <div ref={scrollerRef} className="rec-tier-columns" data-count={count} data-overall={hasOverall || undefined}
        style={{ '--tier-rest-tracks': String(Math.max(1, count - 1)) } as React.CSSProperties}>{children}</div>
    </div>
  );
}

/** Scrolls the sheet by one column. */
function TierScrollCues({ scrollerRef, overflow }: { readonly scrollerRef: React.RefObject<HTMLDivElement>; readonly overflow: ColumnOverflow }): React.ReactElement | null {
  if (!overflow.start && !overflow.end) return null;
  const scrollByColumn = (direction: 1 | -1): void => {
    const element = scrollerRef.current;
    const column = element?.querySelector('.rec-tier-column');
    if (!element || !column) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollBy({ left: direction * column.getBoundingClientRect().width, behavior: reduce ? 'auto' : 'smooth' });
  };
  return (
    <div className="rec-tier-scroll-cues" role="group" aria-label="Scroll tier columns">
      <button type="button" className="rec-tier-scroll-cue" data-side="start" data-tier-scroll-cue="" disabled={!overflow.start} onClick={() => { scrollByColumn(-1); }}>
        <ArrowLeft aria-hidden="true" /> Earlier columns
      </button>
      <button type="button" className="rec-tier-scroll-cue" data-side="end" data-tier-scroll-cue="" disabled={!overflow.end} onClick={() => { scrollByColumn(1); }}>
        More columns <ArrowRight aria-hidden="true" />
      </button>
    </div>
  );
}

/** Position columns grouped by tier: how much is left at each position, beside Suggestions. */
export function PositionTiersView({
  selectedPlayerId,
  onSelect,
}: {
  readonly selectedPlayerId: string | undefined;
  /** `origin` is the clicked row button, so closing the analysis can return focus to that exact copy. */
  readonly onSelect: (playerId: string, origin: HTMLElement) => void;
}): React.ReactElement {
  const {
    players, playerById, draftedPlayerIds, draftedPickLabels, recommendationById, availabilityById, finalPick, bestPickId,
    queuedSet, needs, nextPickLabel, onQueue,
    // The league's team count makes each Overall band about one round.
    totalTeams: bandSize,
  } = useAssistantData();
  const [filter, setFilter] = React.useState<TierFilter>('ALL');
  const [query, setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const searchRef = React.useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);
  const [showDrafted, setShowDrafted] = React.useState(false);
  // Extra pages shown per column, beyond the first VISIBLE_PLAYERS_PER_COLUMN rows.
  const [columnPages, setColumnPages] = React.useState<ReadonlyMap<TierColumn['key'], number>>(new Map());
  const columns = React.useMemo((): readonly TierColumn[] => {
    const positionColumns = (filter === 'ALL' ? DEFAULT_POSITIONS : [filter]).map((position): TierColumn => ({
      key: position,
      ...buildPositionTiers({ players, position, draftedPlayerIds, query: deferredQuery, showDrafted }),
    }));
    if (filter !== 'ALL') return positionColumns;
    const overall = buildOverallBands({ players, draftedPlayerIds, bandSize, query: deferredQuery, showDrafted });
    return [{ key: 'OVERALL', position: null, ...overall }, ...positionColumns];
  }, [players, filter, draftedPlayerIds, deferredQuery, showDrafted, bandSize]);
  // Only columns with matches render, and the grid declares exactly that many tracks: a sparse search never leaves
  // empty tracks for "More columns" to scroll into (R9-5).
  const renderedColumns = React.useMemo(() => columns.filter((column) => column.groups.length > 0), [columns]);
  const anyMatches = renderedColumns.length > 0;
  const hasDraftedMatch = React.useMemo(() => {
    if (anyMatches || showDrafted || deferredQuery.trim() === '') return false;
    return columns.length > 0 && (filter === 'ALL' ? DEFAULT_POSITIONS : [filter]).some((position) =>
      buildPositionTiers({ players, position, draftedPlayerIds, query: deferredQuery, showDrafted: true }).groups.length > 0);
  }, [anyMatches, columns.length, deferredQuery, draftedPlayerIds, filter, players, showDrafted]);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const pagesKey = [...columnPages].map(([key, pages]) => `${key}:${String(pages)}`).join(',');
  const overflow = useColumnOverflow(scrollerRef, `${renderedColumns.map((column) => column.key).join(',')}|${filter}|${deferredQuery}|${String(showDrafted)}|${pagesKey}`);
  const isFinal = finalPick;
  // One availability object per player, so a memoized row re-renders only when its own figure changes.
  const rowAvailability = React.useMemo(
    () => new Map(players.map((player) => [player.id, getTierRowAvailability(player.id, recommendationById.get(player.id), availabilityById, isFinal)])),
    [availabilityById, isFinal, players, recommendationById]
  );
  const setPages = (key: TierColumn['key'], pages: number): void => {
    setColumnPages((current) => new Map(current).set(key, pages));
  };

  const renderGroup = (group: TierGroup | OverallBand, column: TierColumn, listed: readonly TierPlayer[]): React.ReactElement => {
    const key = `${column.key}-${String(group.tier)}`;
    return (
      <section key={key} className="rec-tier-group" aria-label={column.position ? `${column.position} Tier ${String(group.tier)}` : `Overall ${groupTitle(group)}`}>
        <div className="rec-tier-header">
          <strong>{groupTitle(group)}</strong>
          <span className="rec-muted">{String(group.available)} of {String(group.total)} remaining</span>
        </div>
        {isTierDepleted(group) ? <p className="rec-tier-caption">Only {String(group.available)} left in this tier</p> : null}
        <ol>
          {listed.map((player) => (
            <TierRow
              key={player.id}
              player={player}
              detail={playerById.get(player.id)}
              drafted={draftedPlayerIds.has(player.id)}
              draftedPickLabel={draftedPickLabels.get(player.id)}
              availability={rowAvailability.get(player.id) ?? UNESTIMATED}
              isBestPick={player.id === bestPickId}
              isSelected={player.id === selectedPlayerId}
              isQueued={queuedSet.has(player.id)}
              nextPickLabel={nextPickLabel}
              showPosition={column.position === null}
              onSelect={onSelect}
              onQueue={onQueue}
            />
          ))}
        </ol>
      </section>
    );
  };

  return (
    <section className="rec-tiers" aria-labelledby="rec-tiers-heading">
      <div className="rec-section-heading">
        <h1 id="rec-tiers-heading">Position tiers</h1>
        <span className="rec-muted">
          Players of similar value, grouped; Overall bands the expert order by round. {nextPickLabel
            ? `% is the chance a player is still there at ${nextPickLabel}.`
            : 'Final pick: no later pick to estimate.'}
        </span>
      </div>
      <div className="rec-pool-toolbar">
        <label className="rec-search">
          <Search className="size-4" aria-hidden="true" />
          <span className="sr-only">Search players in tiers</span>
          <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="Search player or team" aria-keyshortcuts="/"
            onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} />
          {query ? (
            <button type="button" className="rec-search-clear" aria-label="Clear tier search" onClick={() => { setQuery(''); }}>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <div className="rec-filters" role="group" aria-label="Filter tiers by position">
          {FILTERS.map((position) => {
            const need = position === 'ALL' ? undefined : needs.find((item) => item.position === position);
            return (
              <button
                key={position}
                type="button"
                aria-pressed={filter === position}
                aria-label={position === 'ALL' ? 'QB, RB, WR and TE' : `${position}, ${String(need?.startersFilled ?? 0)} of ${String(need?.startersNeeded ?? 0)} starters filled`}
                onClick={() => { setFilter(position); }}
              >
                <span>{position === 'ALL' ? 'All' : position}</span>
                {need ? <small>{String(need.startersFilled)}/{String(need.startersNeeded)}</small> : null}
              </button>
            );
          })}
        </div>
        <label className="rec-checkbox">
          <input type="checkbox" checked={showDrafted} onChange={(event) => { setShowDrafted(event.target.checked); }} />
          Show drafted
        </label>
        <TierScrollCues scrollerRef={scrollerRef} overflow={overflow} />
      </div>
      {anyMatches ? (
        <TierColumns scrollerRef={scrollerRef} overflow={overflow} count={renderedColumns.length} hasOverall={renderedColumns[0]?.key === 'OVERALL'}>
          {renderedColumns.map((column) => {
            const pages = columnPages.get(column.key) ?? 0;
            const total = column.groups.reduce((sum, group) => sum + group.players.length, 0);
            // Fill the column tier by tier up to the player budget; a tier cut part-way shows its first players.
            let budget = getTierColumnBudget(pages, deferredQuery.trim() !== '');
            const visible = column.groups.flatMap((group) => {
              if (budget <= 0) return [];
              const listed = group.players.slice(0, budget);
              budget -= listed.length;
              return [{ group, listed }];
            });
            const hidden = total - visible.reduce((sum, item) => sum + item.listed.length, 0);
            return (
              <div key={column.key} className="rec-tier-column" data-key={column.key}>
                <h2 className="rec-tier-title">
                  {column.position ? <><PositionTag position={column.position} />{POSITION_NAMES[column.position]}</> : 'Overall'}
                </h2>
                <div className="rec-tier-colhead" aria-hidden="true" title={`${RANKING_LABELS.title} (${RANKING_LABELS.source}), not the model's overall rank`}>
                  <span className="rec-tier-colhead-rank">{TIER_RANK_HEADER}</span>
                  <span>Player</span>
                  <span />
                  <span className="rec-tier-colhead-value">{nextPickLabel ? '%' : ''}</span>
                </div>
                {column.exhaustedTiers.length > 0 && !showDrafted ? (
                  <p className="rec-tier-exhausted">
                    {column.activeTier === null
                      ? column.position ? 'All tiers are drafted.' : 'All ranked players are drafted.'
                      : column.position
                        ? `Tier ${column.exhaustedTiers.join(', ')} drafted. Showing Tier ${String(column.activeTier)} onward.`
                        : `${String(column.exhaustedTiers.length)} ${column.exhaustedTiers.length === 1 ? 'band' : 'bands'} drafted.`}
                  </p>
                ) : null}
                {visible.map(({ group, listed }) => renderGroup(group, column, listed))}
                {hidden > 0 || pages > 0 ? (
                  <div className="rec-tier-more">
                    {hidden > 0 ? (
                      <button type="button" className="rec-text-button" onClick={() => { setPages(column.key, pages + 1); }}>
                        Show {String(Math.min(hidden, TIER_PAGE_SIZE))} more{hidden > TIER_PAGE_SIZE ? ` of ${String(hidden)}` : ''}
                      </button>
                    ) : null}
                    {pages > 0 ? (
                      <button type="button" className="rec-text-button" onClick={() => { setPages(column.key, 0); }}>Show fewer</button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </TierColumns>
      ) : (
        filter !== 'ALL' && !showDrafted && deferredQuery.trim() === '' && players.some((player) => player.position === filter) ? (
          // Every player at this position is gone: say so, with the way to see them, not "No matching players".
          <p className="rec-empty" role="status" data-tiers-drafted-out="">
            All {filter === 'DEF' ? 'defenses' : `${filter}s`} drafted ·{' '}
            <button type="button" className="rec-text-button" onClick={() => { setShowDrafted(true); }}>Show drafted</button>
          </p>
        ) : deferredQuery.trim() !== '' && !showDrafted && hasDraftedMatch ? (
          // Only drafted players match: say so and offer them, instead of implying the player does not exist.
          <p className="rec-empty" role="status" data-tiers-drafted-match="">
            Every player matching “{deferredQuery.trim()}” has been drafted ·{' '}
            <button type="button" className="rec-text-button" onClick={() => { setShowDrafted(true); }}>Show drafted</button>
          </p>
        ) : (
          <p className="rec-empty" role="status">No matching players. Clear the search or choose another position.</p>
        )
      )}
    </section>
  );
}
