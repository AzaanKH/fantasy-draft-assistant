import * as React from 'react';
import type { Player } from '@fantasy-draft/shared/league';
import { POSITIONS } from '@fantasy-draft/shared/league';
import { LoadingStatus, SkeletonBlock, SkeletonText } from '@/components/skeletons';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { getPositionRun } from '@/features/assistant/assistant-context';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useTeamNeeds } from '@/hooks/useTeamNeeds';
import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { useIdsInViewport } from '@/lib/use-in-viewport';
import { isEditableTarget } from './pool-keyboard';
import { ACTIONS, CARD, FACT, FACTS, HEADSHOT, NAME, ROW_CARD, ROW_HEADSHOT } from './suggestion-card-parts';
import { getDistinguishingFacts, getRecommendationVerdict, getSuggestionReasonChips, getSuggestionSummaryCandidates, separateSuggestionSummaries, VERDICT_RULE, type ReasonChip } from './suggestion-reasons';
import { selectCardSignals } from './suggestion-signals';
import { getGapsToTop } from './suggestion-separation';
import { SuggestionRow } from './SuggestionRow';
import { SuggestionTile } from './SuggestionTile';
import { SUGGESTION_COUNT, useSharedSuggestionActions, WithSuggestionActions } from './SuggestionActionsContext';
import { usePickFailureReporter, usePickLock } from '@/workspace/pick-in-flight';

export { SUGGESTION_COUNT } from './SuggestionActionsContext';

/** Container-sized, so the cards stay readable in the narrow split-layout sidebar and spread out when the dock is wide. */
const SUGGESTION_GRID = 'grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-4';

type SuggestionVariant = 'dock' | 'assistant';

function SuggestionCardPlaceholder({ variant, lead = false }: { readonly variant: SuggestionVariant; readonly lead?: boolean }): React.ReactElement {
  if (variant === 'assistant') {
    // The same grid areas as a loaded row (the leader's larger one first), so the list keeps its height when data arrives.
    return (
      <li aria-hidden="true">
        <div className={ROW_CARD} data-lead={lead || undefined}>
          <SkeletonBlock className={ROW_HEADSHOT} />
          <div className="suggestion-identity">
            <div className="suggestion-title"><span className="suggestion-name"><SkeletonText className="w-40" /></span><span className="suggestion-meta"><SkeletonText className="w-28" /></span></div>
            <div className="suggestion-signals">
              <SkeletonBlock className="h-[18px] w-16" /><SkeletonBlock className="h-[18px] w-14" />
              <div className="suggestion-reason"><p><SkeletonText className="w-3/5" /></p><span className="suggestion-reason-toggle"><SkeletonText className="w-20" /></span></div>
            </div>
          </div>
          <div className="suggestion-confidence"><strong><SkeletonText className="w-10" /></strong><span><SkeletonText className="w-16" /></span></div>
          <div className="suggestion-actions"><SkeletonBlock className="h-8 w-20" /><SkeletonBlock className="h-8 w-9" /></div>
        </div>
      </li>
    );
  }
  return (
    <li aria-hidden="true" className={CARD}>
      <div className="flex items-start gap-3">
        <SkeletonBlock className={HEADSHOT} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><SkeletonBlock className="h-5 w-20" /></div>
          <h3 className={NAME}><SkeletonText className="w-32" /></h3>
          <p className="mt-1 text-xs leading-relaxed"><SkeletonText className="w-full" /><br /><SkeletonText className="w-4/5" /></p>
        </div>
      </div>
      <div className={FACTS}>
        <span className={FACT}><SkeletonText className="w-16" /></span>
        <span className={FACT}><SkeletonText className="w-16" /></span>
        <span className={FACT}><SkeletonText className="w-12" /></span>
      </div>
      <div className={ACTIONS}><SkeletonBlock className="h-8 flex-1" /></div>
    </li>
  );
}

/** The loading list: the loaded list's own rows with placeholders, so nothing moves when data arrives. */
export function SuggestionListPlaceholder({ variant }: { readonly variant: SuggestionVariant }): React.ReactElement {
  return (
    <>
      <LoadingStatus label="Loading suggestions" />
      <ol className={variant === 'assistant' ? 'suggestion-list' : SUGGESTION_GRID} aria-hidden="true">
        {Array.from({ length: SUGGESTION_COUNT }, (_, index) => <SuggestionCardPlaceholder key={index} variant={variant} lead={index === 0} />)}
      </ol>
    </>
  );
}

/**
 * True when a 1-4 key press should act: focus is on the list itself, a card, or a card's selection button, never on
 * an action inside a card (Draft, Queue, Full reasoning).
 */
export function isSuggestionShortcutTarget(target: EventTarget | null, list: EventTarget): boolean {
  if (target === list) return true;
  return target instanceof HTMLElement && (target.hasAttribute('data-suggestion-card') || target.hasAttribute('data-suggestion-select'));
}

interface DraftSuggestionsProps {
  readonly onOpenAssistant?: (target: AssistantNavigationTarget) => void;
  readonly variant?: SuggestionVariant;
  /** Overrides "Why", e.g. to open the analysis on the same page. */
  readonly onExplain?: (playerId: string) => void;
  /** Assistant: picking a card makes it the analysis subject. */
  readonly onSelect?: (playerId: string) => void;
  readonly selectedPlayerId?: string;
}

/**
 * Ranked suggestions with each card's mode-appropriate action: Draft on your turn in a mock, the
 * Provisional Pick dialog during live Manual Continuity (never a direct submit), otherwise Queue.
 * The dock and the Assistant page both render this list, on the workspace's shared suggestion actions.
 */
export function DraftSuggestions(props: DraftSuggestionsProps): React.ReactElement {
  return <WithSuggestionActions><SuggestionList {...props} /></WithSuggestionActions>;
}

function SuggestionList({
  onOpenAssistant,
  variant = 'dock',
  onExplain,
  onSelect,
  selectedPlayerId,
}: DraftSuggestionsProps): React.ReactElement {
  const { overall, isLoading: decisionLoading } = useDraftDecision();
  const { needs } = useTeamNeeds();
  const myRoster = useDraftView((view) => view.myRoster);
  const sessionMode = useDraftState((state) => state.sessionMode);
  const draftHistory = useDraftState((state) => state.draftHistory);
  const shared = useSharedSuggestionActions();
  if (!shared) throw new Error('SuggestionList renders inside WithSuggestionActions');
  const { suggestions, playerById, playersLoading, queuedSet, actionById, draft, togglePlayerQueued, actOnSuggestion, setRecordPlayerId } = shared;
  const suggestionIds = React.useMemo(() => suggestions.map((recommendation) => recommendation.playerId), [suggestions]);
  const listRef = React.useRef<HTMLOListElement>(null);
  const [mounted, setMounted] = React.useState(false);
  // A card reports its own failure only while its actions (Draft, which becomes Retry) are wholly on screen and not
  // under the sticky header. A player who leaves the top four, or a card scrolled even partly out of view, falls back
  // to the workspace notice and its Retry instead of an error on a control nobody can reach (R9-2).
  const visibleIds = useIdsInViewport(listRef, 'data-suggestion-action', suggestionIds, mounted, VISIBLE_ACTION);
  usePickFailureReporter(usePickLock(), draft.origin, visibleIds);
  const { canDraft, canDraftPlayer, draftPlayer, draftStatus, pickInFlight } = draft;
  const rosteredPlayers = React.useMemo(
    () => POSITIONS.flatMap((position) => myRoster[position]).map((id) => playerById.get(id)).filter((player): player is Player => player !== undefined),
    [myRoster, playerById]
  );
  const gaps = React.useMemo(() => getGapsToTop(suggestions.map((recommendation) => ({
    playerId: recommendation.playerId,
    valueOverReplacement: recommendation.diagnostics?.valueOverReplacement ?? playerById.get(recommendation.playerId)?.valueOverReplacement,
  }))), [playerById, suggestions]);
  // Chips are per card and change only with the inputs they read, so a card re-renders only when its own facts move.
  const reasonsById = React.useMemo(() => new Map(suggestions.map((recommendation) => [
    recommendation.playerId,
    getSuggestionReasonChips({ recommendation, player: playerById.get(recommendation.playerId), needs, rosteredPlayers }),
  ])), [needs, playerById, rosteredPlayers, suggestions]);
  // A run is per position, so cards at the same position share one object and keep their memoized render.
  const runByPosition = React.useMemo(() => {
    const recent = [...draftHistory].sort((first, second) => first.pickNumber - second.pickNumber);
    return new Map(POSITIONS.map((position) => [position, getPositionRun(position, recent)]));
  }, [draftHistory]);
  // Each card's line states at least one fact the other three do not, so no two cards read the same.
  const summaryById = React.useMemo(() => separateSuggestionSummaries(suggestions.map((recommendation) => ({
    playerId: recommendation.playerId,
    candidates: getSuggestionSummaryCandidates({
      recommendation,
      gap: gaps.get(recommendation.playerId) ?? null,
      run: runByPosition.get(recommendation.position) ?? null,
      reasons: reasonsById.get(recommendation.playerId) ?? NO_REASONS,
    }),
    extras: getDistinguishingFacts(recommendation, playerById.get(recommendation.playerId)),
  }))), [gaps, playerById, reasonsById, runByPosition, suggestions]);
  // Assistant only: the chips are chosen across the four cards, so a chip always sets its card apart.
  const signalsById = React.useMemo(() => variant !== 'assistant' ? null : selectCardSignals(suggestions.map((recommendation) => ({
    playerId: recommendation.playerId,
    player: playerById.get(recommendation.playerId),
    verdict: getRecommendationVerdict(recommendation)?.kind ?? null,
    reasons: reasonsById.get(recommendation.playerId) ?? NO_REASONS,
  }))), [playerById, reasonsById, suggestions, variant]);
  const explain = React.useCallback((playerId: string) => {
    if (onExplain) onExplain(playerId);
    else onOpenAssistant?.({ lens: 'why', selectedPlayerId: playerId });
  }, [onExplain, onOpenAssistant]);
  const listClass = variant === 'assistant' ? 'suggestion-list' : SUGGESTION_GRID;
  const SuggestionCard = variant === 'assistant' ? SuggestionRow : SuggestionTile;
  const ruleId = React.useId();
  const loading = decisionLoading || playersLoading;
  React.useEffect(() => { setMounted(!loading); }, [loading]);
  // Readiness reads as blocked until player data arrives, which turns the decision's own loading flag off.
  if (loading) return <SuggestionListPlaceholder variant={variant} />;

  // Keys 1-4 act on the matching card with Enter's rules (Draft, Record, or add to queue). From the list or a card
  // itself they always work, whatever the shortcut preference; never from a control inside a card (Full reasoning,
  // Queue). Page-wide they work only on the clock, through useSuggestionHotkeys.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLOListElement>): void => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
    if (!isSuggestionShortcutTarget(event.target, event.currentTarget)) return;
    if (actOnSuggestion(Number(event.key) - 1)) event.preventDefault();
  };
  return (
    <>
      {/* The Assistant's page heading is an h1 and each card's name an h3: this keeps the outline in order. */}
      {variant === 'assistant' ? <h2 className="sr-only">Suggested picks</h2> : null}
      {/* data-suggestion-list: SUGGESTION_LIST_ATTRIBUTE, how the page-wide keys find this list. */}
      <ol ref={listRef} data-suggestion-list="" className={listClass} aria-label="Suggested picks, best first" aria-describedby={ruleId} aria-keyshortcuts="1 2 3 4" tabIndex={-1} onKeyDown={onListKeyDown}>
        {suggestions.map((recommendation, index) => (
          <li key={recommendation.playerId} data-suggestion-player={recommendation.playerId} className={variant === 'assistant' ? undefined : 'flex min-w-0'}>
            <SuggestionCard
              recommendation={recommendation}
              rank={overall.rankByPlayerId.get(recommendation.playerId) ?? index + 1}
              shortcut={index + 1}
              player={playerById.get(recommendation.playerId)}
              action={actionById.get(recommendation.playerId) ?? 'queue'}
              positionFull={sessionMode === 'mock' && canDraft && !canDraftPlayer(recommendation)}
              gap={gaps.get(recommendation.playerId) ?? null}
              run={runByPosition.get(recommendation.position) ?? null}
              reasons={reasonsById.get(recommendation.playerId) ?? NO_REASONS}
              summary={summaryById.get(recommendation.playerId) ?? null}
              lead={variant === 'assistant' && index === 0}
              signals={signalsById?.get(recommendation.playerId)}
              pickInFlight={pickInFlight}
              isQueued={queuedSet.has(recommendation.playerId)}
              isSelected={recommendation.playerId === selectedPlayerId}
              draftStatus={draftStatus?.playerId === recommendation.playerId ? draftStatus : undefined}
              onDraft={draftPlayer}
              onRecord={setRecordPlayerId}
              onToggleQueue={togglePlayerQueued}
              onExplain={explain}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ol>
      {/* The verdict rule, once for the list instead of on every card. After the list, so a parent's spacing never shifts it. */}
      <p id={ruleId} className="sr-only">{VERDICT_RULE}</p>
    </>
  );
}

const NO_REASONS: readonly ReasonChip[] = [];
const VISIBLE_ACTION = { fully: true, belowStickyHeader: true } as const;
