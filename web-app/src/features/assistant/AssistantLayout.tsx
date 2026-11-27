import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { createSlotSequence, DECISION_LENSES, DECISION_LENS_LABELS, type DecisionLens } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { LoadingStatus, SkeletonBlock, SkeletonText } from '@/components/skeletons';
import { DraftTurnBanner } from '@/features/draft-room/DraftTurnBanner';
import { SuggestionListPlaceholder } from '@/features/draft-room/DraftSuggestions';
import { SuggestionShortcutHint } from '@/features/draft-room/SuggestionShortcutHint';
// data-suggestion-keys on each Assistant <main>: SUGGESTION_KEYS_ATTRIBUTE, so 1-4 act only on cards on screen.
import { RANKING_LABELS } from '@/lib/demo-mode';
import { formatNextTurn, getPickWindow, picksUntilTurn } from './assistant-context';
import type { AssistantLens } from './assistant-navigation';
import { AssistantRailSummary } from './AssistantRail';
import './assistant.css';
import './decision-hero.css';

/**
 * The Assistant's layout. AssistantPage loads lazily, so its loading state renders these same pieces
 * from the main chunk, with placeholders where the page shows data.
 */

export type AssistantView = 'suggestions' | 'tiers';

/**
 * The analysis tabs. "Can I wait?" is not a tab: the take-now-or-wait answer is always visible above them,
 * so a request for the wait lens opens the analysis on Why this player?.
 */
export type AnalysisTab = Exclude<AssistantLens, 'wait'>;

/** Short enough that all three fit the tier drawer's narrower column (326px of tabs) without scrolling the strip. */
export const ANALYSIS_TABS: readonly { readonly id: AnalysisTab; readonly label: string }[] = [
  { id: 'why', label: 'Why this player?' },
  { id: 'compare', label: 'Compare' },
  { id: 'roster', label: 'Roster needs' },
];

export function toAnalysisTab(lens: AssistantLens): AnalysisTab {
  return lens === 'wait' ? 'why' : lens;
}

const RAIL_SECTIONS = ['Your queue', 'Before your next pick', 'Your roster'] as const;

export function AssistantViewTabs({
  view,
  onChange,
}: {
  readonly view: AssistantView;
  /** Omitted while the page loads, which disables the tabs. */
  readonly onChange?: (view: AssistantView) => void;
}): React.ReactElement {
  return (
    <div
      className="rec-tabs rec-view-tabs"
      role="tablist"
      aria-label="Assistant view"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = view === 'suggestions' ? 'tiers' : 'suggestions';
        const target = event.key === 'Home' ? 'suggestions' : event.key === 'End' ? 'tiers' : next;
        if (!onChange) return;
        onChange(target);
        document.getElementById(`rec-view-${target}`)?.focus();
      }}
    >
      {(['suggestions', 'tiers'] as const).map((item) => (
        <button
          key={item}
          id={`rec-view-${item}`}
          type="button"
          role="tab"
          aria-selected={view === item}
          // Only the shown view's panel is rendered, so only the selected tab may point at it.
          aria-controls={view === item ? `rec-view-panel-${item}` : undefined}
          tabIndex={view === item ? 0 : -1}
          disabled={!onChange}
          onClick={() => { onChange?.(item); }}
        >
          {item === 'suggestions' ? 'Suggestions' : 'Position tiers'}
        </button>
      ))}
    </div>
  );
}

export function AnalysisTabs({
  tab,
  onChange,
}: {
  readonly tab: AnalysisTab;
  /** Omitted while the page loads, which disables the tabs. */
  readonly onChange?: (tab: AnalysisTab) => void;
}): React.ReactElement {
  const selectedIndex = ANALYSIS_TABS.findIndex((item) => item.id === tab);
  return (
    <div
      className="rec-tabs"
      role="tablist"
      aria-label="Analysis question"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? ANALYSIS_TABS.length - 1
            : (selectedIndex + (event.key === 'ArrowRight' ? 1 : -1) + ANALYSIS_TABS.length) % ANALYSIS_TABS.length;
        const target = ANALYSIS_TABS[next];
        if (!target || !onChange) return;
        onChange(target.id);
        document.getElementById(`rec-tab-${target.id}`)?.focus();
      }}
    >
      {ANALYSIS_TABS.map((item) => (
        <button
          key={item.id}
          id={`rec-tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          aria-controls="rec-analysis-panel"
          tabIndex={tab === item.id ? 0 : -1}
          disabled={!onChange}
          onClick={() => { onChange?.(item.id); }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** What each lens ranks by: the hover text of its button. */
export const LENS_BASIS: Readonly<Record<DecisionLens, string>> = {
  'ranked-fit': `${RANKING_LABELS.short} order among players who keep a legal roster`,
  'best-pick': 'League value, roster fit and draft timing',
  'best-player': `Player quality (${RANKING_LABELS.short}), without roster or timing`,
};

export function LensToggle({
  lens,
  onChange,
}: {
  readonly lens: DecisionLens;
  readonly onChange?: (lens: DecisionLens) => void;
}): React.ReactElement {
  return (
    <div className="rec-lens" role="group" aria-label="Decision lens">
      {DECISION_LENSES.map((item) => (
        <button key={item} type="button" title={LENS_BASIS[item]} aria-pressed={lens === item} disabled={!onChange} onClick={() => { onChange?.(item); }}>{DECISION_LENS_LABELS[item]}</button>
      ))}
    </div>
  );
}

/**
 * The decision hero's first row: the turn banner (shown on the clock, a keeper slot or picks done), the current pick
 * and when your next turn comes, and the lens. The loading skeleton renders this same row, so it never moves.
 */
export function HeroTopRow({
  lens,
  onLensChange,
}: {
  readonly lens: DecisionLens;
  /** Omitted while the page loads, which disables the lens. */
  readonly onLensChange?: (lens: DecisionLens) => void;
}): React.ReactElement {
  const config = useDraftState((state) => state.config);
  const currentPick = useDraftView((view) => view.currentPick);
  const order = createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds });
  const pickWindow = getPickWindow(currentPick, config.totalTeams, config.totalRounds, config.myPickPosition, config.draftType);
  const currentLabel = currentPick <= config.totalTeams * config.totalRounds ? order.label(currentPick) : null;
  const nextLabel = pickWindow.nextPick === null ? null : order.label(pickWindow.nextPick);
  const nextTurn = formatNextTurn(picksUntilTurn(pickWindow), nextLabel);
  return (
    <div className="call-top">
      {/* Waiting, the banner is visually hidden (the line beside it counts the picks) but stays mounted, so its
          announcement still fires when the clock comes round. */}
      <span className="call-turn"><DraftTurnBanner variant="compact" showPick={false} /></span>
      {currentLabel ? (
        <span className="call-context">
          Pick {currentLabel}{' · '}
          {/* The page's one statement of the next turn. */}
          <span data-next-turn={nextTurn ? '' : undefined}>{nextTurn ?? (pickWindow.onClock ? 'Your final pick' : 'No picks left')}</span>
        </span>
      ) : null}
      <LensToggle lens={lens} onChange={onLensChange} />
    </div>
  );
}

/** The decision hero while the page loads: its real first row, and placeholders for the call. */
function DecisionHeroPlaceholder({ lens }: { readonly lens: DecisionLens }): React.ReactElement {
  return (
    <section className="call" data-loading="" aria-label="Decision">
      <HeroTopRow lens={lens} />
      <div className="call-main" aria-hidden="true">
        <span className="call-headshot" />
        <div className="call-copy">
          <SkeletonBlock className="call-placeholder-name" />
          <p className="call-why"><SkeletonText className="w-72" /></p>
        </div>
        <div className="call-actions">
          <SkeletonBlock className="h-11 w-full" />
          <SkeletonBlock className="h-10 w-full" />
        </div>
      </div>
      <div className="call-foot" aria-hidden="true">
        <div className="call-stats">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="call-stat"><strong><SkeletonText className="w-14" /></strong><span><SkeletonText className="w-20" /></span></div>
          ))}
        </div>
        <div className="call-skip"><span className="call-skip-label"><SkeletonText className="w-48" /></span><ul><li><SkeletonText className="w-80" /></li></ul></div>
      </div>
    </section>
  );
}

/** The suggestions toolbar: the shortcut hint and the player search. The page's h1 is the decision hero's call. */
export function LeadHeading({
  search,
  cardsShown = true,
}: {
  /** Player search, beside the cards it replaces while it has a query. */
  readonly search?: React.ReactNode;
  /** False while search results replace the cards: no "Press 1–4" for cards that are not there. */
  readonly cardsShown?: boolean;
}): React.ReactElement {
  return (
    <div className="rec-section-heading rec-lead-heading">
      {/* Kept in the layout while hidden, so the row does not shift when a search starts. */}
      <span className="rec-lead-hint" data-hidden={cardsShown ? undefined : ''} aria-hidden={cardsShown ? undefined : true}><SuggestionShortcutHint /></span>
      <div className="rec-lead-tools">
        {search}
      </div>
    </div>
  );
}

/**
 * The Suggestions view: the cards and player list in the center, the one analysis area pinned beside them, and the
 * queue, upcoming picks and roster. Very wide screens put that rail in its own column beside the analysis; laptop
 * widths put it below the player list and keep a one-line summary of it above the analysis instead, so the pinned
 * column is exactly the analysis plus that line and never scrolls (the analysis's tab answer is the only scroller).
 */
export function SuggestionsLayout({
  main,
  analysis,
  summary,
  rail,
}: {
  readonly main: React.ReactNode;
  readonly analysis: React.ReactNode;
  readonly summary: React.ReactNode;
  readonly rail: React.ReactNode;
}): React.ReactElement {
  return (
    <div id="rec-view-panel-suggestions" role="tabpanel" aria-labelledby="rec-view-suggestions">
      <div className="rec-layout">
        <div className="rec-main">{main}</div>
        <div className="rec-side" role="region" aria-label="Analysis">
          {/* First, so it is on screen at page load as well as once the column is pinned. */}
          {summary}
          {analysis}
        </div>
        {/* Focusable: on wide screens it is its own scroll region, and an empty queue leaves nothing else to focus. */}
        <aside className="rec-rail" aria-label="Queue, upcoming picks and roster" tabIndex={0}>
          {rail}
        </aside>
      </div>
    </div>
  );
}

/** Loading state for the lazy Assistant page: the real layout, tabs and headings, with placeholders for player data. */
export function AssistantSkeleton({
  analysisTab,
}: {
  readonly analysisTab: AssistantLens;
}): React.ReactElement {
  const lens = useDraftState((state) => state.decisionLens);
  return (
    <main className="assistant-workspace rec-workspace" aria-busy="true" data-suggestion-keys="">
      <LoadingStatus label="Loading the Assistant" />
      <DecisionHeroPlaceholder lens={lens} />
      <div className="rec-context">
        <AssistantViewTabs view="suggestions" />
      </div>
      <SuggestionsLayout
        main={(
          <>
            <LeadHeading search={<SearchPlaceholder />} />
            <SuggestionListPlaceholder variant="assistant" />
          </>
        )}
        analysis={<AssistantAnalysisPlaceholder tab={toAnalysisTab(analysisTab)} />}
        summary={<AssistantRailSummary nextPickLabel={undefined} queueCount={undefined} />}
        rail={RAIL_SECTIONS.map((title) => (
          <section key={title} className="rec-rail-section">
            <div className="rec-section-heading"><h2>{title}</h2></div>
            <p className="rec-rail-note"><SkeletonText className="w-full" /></p>
            <p className="rec-rail-note"><SkeletonText className="w-3/4" /></p>
          </section>
        ))}
      />
    </main>
  );
}

function SearchPlaceholder(): React.ReactElement {
  return <span className="rec-search" aria-hidden="true"><SkeletonText className="w-32" /></span>;
}

/** The analysis area while the page loads: the same sections, with placeholders for player data. */
function AssistantAnalysisPlaceholder({ tab }: { readonly tab: AnalysisTab }): React.ReactElement {
  return (
    <section className="rec-analysis" aria-label="Viewed player analysis">
      <header className="rec-analysis-identity">
        <div className="rec-analysis-title">
          <div className="rec-analysis-name"><SkeletonText className="w-40" /></div>
          <span className="rec-meta"><SkeletonText className="w-16" /></span>
        </div>
        <div className="rec-viewed-action"><span className="rec-viewed-action-buttons"><SkeletonBlock className="rec-action h-8 w-20" /><SkeletonBlock className="size-8" /></span></div>
        <p className="rec-analysis-sub"><span className="rec-card-label"><SkeletonText className="w-24" /></span></p>
      </header>
      <section className="rec-decision" aria-hidden="true">
        <div className="rec-decision-head"><SkeletonBlock className="h-[18px] w-16" /><p className="rec-decision-reason"><SkeletonText className="w-48" /></p></div>
        <dl className="rec-decision-facts">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={index > 1 ? 'rec-decision-wide' : undefined}><dt><SkeletonText className="w-20" /></dt><dd><SkeletonText className="w-16" /></dd></div>
          ))}
        </dl>
      </section>
      <AnalysisTabs tab={tab} />
      <div id="rec-analysis-panel" role="tabpanel" aria-labelledby={`rec-tab-${tab}`} className="rec-answer">
        {/* Why this player? has four rows and the calculation toggle; the column's fixed height covers the rest. */}
        <div className="rec-answer-rows">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index}><SkeletonText className="w-28" /><SkeletonText className="w-full" /></div>
          ))}
        </div>
        <div className="rec-details"><SkeletonText className="w-32" /></div>
      </div>
    </section>
  );
}
