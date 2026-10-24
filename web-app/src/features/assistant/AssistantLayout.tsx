import { useDraftState } from '@/workspace/WorkspaceProvider';
import type { DecisionLens } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { LoadingStatus, SkeletonBlock, SkeletonText } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { RANKING_LABELS } from '@/lib/demo-mode';
import type { AssistantLens } from './assistant-navigation';
import './assistant.css';

/**
 * The Assistant's layout. AssistantPage loads lazily, so its loading state renders these same pieces
 * from the main chunk, with placeholders where the page shows data.
 */

export type AssistantView = 'suggestions' | 'tiers';

export const ANALYSIS_TABS: readonly { readonly id: AssistantLens; readonly label: string }[] = [
  { id: 'why', label: 'Why this player?' },
  { id: 'compare', label: 'Compare options' },
  { id: 'wait', label: 'Can I wait?' },
  { id: 'roster', label: 'What does my roster need?' },
];

const RAIL_SECTIONS = ['Your queue', 'Before your next pick', 'Your roster'] as const;

export function AssistantViewTabs({
  view,
  onChange,
}: {
  readonly view: AssistantView;
  readonly onChange: (view: AssistantView) => void;
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
          aria-controls={`rec-view-panel-${item}`}
          tabIndex={view === item ? 0 : -1}
          onClick={() => { onChange(item); }}
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
  readonly tab: AssistantLens;
  readonly onChange: (tab: AssistantLens) => void;
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
        if (!target) return;
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
          onClick={() => { onChange(item.id); }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function LensToggle({
  lens,
  onChange,
}: {
  readonly lens: DecisionLens;
  readonly onChange?: (lens: DecisionLens) => void;
}): React.ReactElement {
  return (
    <div className="rec-lens" role="group" aria-label="Decision lens">
      <button type="button" aria-pressed={lens === 'best-pick'} disabled={!onChange} onClick={() => { onChange?.('best-pick'); }}>Best Pick</button>
      <button type="button" aria-pressed={lens === 'best-player'} disabled={!onChange} onClick={() => { onChange?.('best-player'); }}>Best Player</button>
    </div>
  );
}

export function LeadHeading({
  lens,
  onReturnToDraft,
}: {
  readonly lens: DecisionLens;
  readonly onReturnToDraft: () => void;
}): React.ReactElement {
  return (
    <div className="rec-section-heading">
      <h1>{lens === 'best-pick' ? 'Your Best Pick' : 'Best Player available'}</h1>
      <span className="rec-muted">
        {lens === 'best-pick' ? 'League value + roster fit + draft timing' : `Player quality (${RANKING_LABELS.short}), without roster or timing`}
      </span>
      <Button variant="ghost" size="sm" className="rec-return" onClick={onReturnToDraft}>
        <ArrowLeft className="size-4" aria-hidden="true" /> Draft board
      </Button>
    </div>
  );
}

/** The Suggestions view: the decision column, with the queue, upcoming picks and roster beside it. */
export function SuggestionsLayout({
  main,
  rail,
}: {
  readonly main: React.ReactNode;
  readonly rail: React.ReactNode;
}): React.ReactElement {
  return (
    <div id="rec-view-panel-suggestions" role="tabpanel" aria-labelledby="rec-view-suggestions" className="rec-main">
      <div className="rec-layout">
        <div className="rec-main">{main}</div>
        {/* Focusable so keyboard users can scroll the pinned rail when it has no controls, e.g. an empty queue. */}
        <aside className="rec-rail" aria-label="Queue, upcoming picks and roster" tabIndex={0}>
          {rail}
        </aside>
      </div>
    </div>
  );
}

function PreferredPickPlaceholder({ lens }: { readonly lens: DecisionLens }): React.ReactElement {
  return (
    <div className="rec-card" aria-hidden="true">
      <div className="rec-card-identity">
        <SkeletonBlock className="rec-card-avatar" />
        <div className="min-w-0">
          <div className="rec-card-name"><SkeletonText className="w-48" /></div>
          <div className="rec-meta"><SkeletonText className="w-40" /></div>
        </div>
        <span className="rec-card-label">{lens === 'best-pick' ? 'Best Pick' : 'Best Player'}</span>
      </div>
      <div className="rec-metrics">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rec-metric">
            <div className="rec-metric-value"><SkeletonText className="w-16" /></div>
            <div className="rec-muted"><SkeletonText className="w-28" /></div>
            {index === 0 ? <div className="rec-metric-note"><SkeletonText className="w-36" /></div> : null}
          </div>
        ))}
      </div>
      <div className="rec-actions">
        <SkeletonBlock className="rec-action w-32" />
        <SkeletonBlock className="rec-action w-36" />
      </div>
      <p className="rec-action-note"><SkeletonText className="w-64" /></p>
    </div>
  );
}

/** Loading state for the lazy Assistant page: the real layout, tabs and headings, with placeholders for player data. */
export function AssistantSkeleton({
  lens: analysisTab,
  onReturnToDraft,
}: {
  readonly lens: AssistantLens;
  readonly onReturnToDraft: () => void;
}): React.ReactElement {
  const lens = useDraftState((state) => state.decisionLens);
  return (
    <main className="assistant-workspace rec-workspace" aria-busy="true">
      <LoadingStatus label="Loading the Assistant" />
      <div className="rec-context">
        <div className="rec-context-pick">
          <span className="rec-clock"><SkeletonText className="w-16" /></span>
          <strong><SkeletonText className="w-16" /></strong>
          <span className="rec-muted"><SkeletonText className="w-40" /></span>
        </div>
        <div className="rec-context-status">
          <span className="rec-sync"><SkeletonText className="w-24" /></span>
          <LensToggle lens={lens} />
        </div>
      </div>
      <AssistantViewTabs view="suggestions" onChange={() => undefined} />
      <SuggestionsLayout
        main={(
          <>
            <LeadHeading lens={lens} onReturnToDraft={onReturnToDraft} />
            <PreferredPickPlaceholder lens={lens} />
            <section className="rec-analysis" aria-label="Viewed player analysis">
              <AnalysisTabs tab={analysisTab} onChange={() => undefined} />
              <div className="rec-answer">
                <p className="rec-answer-subject"><SkeletonText className="w-40" /></p>
                <div className="rec-answer-rows">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div key={index}><SkeletonText className="w-28" /><SkeletonText className="w-full" /></div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
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
