import { useDraftState } from '@/workspace/WorkspaceProvider';
import { POSITIONS } from '@fantasy-draft/shared/league';
import { useDraftView } from '@/workspace/useDraftView';
import { RANKING_LABELS } from '@/lib/demo-mode';
import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { MotionExpandable } from '@/components/motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { DraftPlayerPool } from './DraftPlayerPool';
import { DraftQueuePanel } from './DraftQueuePanel';
import { DraftRosterPanel } from './DraftRosterPanel';
import { DraftSuggestions, SUGGESTION_COUNT } from './DraftSuggestions';
import { SuggestionShortcutHint } from './SuggestionShortcutHint';

/** Matches the design system's xl breakpoint, where the roster becomes a sidebar. */
const SPLIT_LAYOUT_QUERY = '(min-width: 80rem)';

function DockTab({
  value,
  label,
  count,
}: {
  readonly value: string;
  readonly label: string;
  readonly count?: React.ReactNode;
}): React.ReactElement {
  return (
    <TabsTrigger value={value} className="draft-dock-tab">
      {label}
      {count !== undefined ? <span className="draft-dock-count">{count}</span> : null}
    </TabsTrigger>
  );
}

export function DraftDock({
  checklist,
  expanded: isExpanded,
  onExpandedChange,
  onOpenAssistant,
}: {
  /** Shown above the dock's columns, inside its frame, and kept while the dock is collapsed. */
  readonly checklist?: React.ReactNode;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const isSplit = useMediaQuery(SPLIT_LAYOUT_QUERY);
  const queuedCount = useDraftView((view) => view.shortlistedPlayerIds.length);
  const totalRounds = useDraftState((state) => state.config.totalRounds);
  const rosterCount = useDraftView((view) =>
    POSITIONS.map(position => view.myRoster[position]).reduce(
      (total, playerIds) => total + playerIds.length,
      0
    )
  );
  const { output, overall, recommendationsBlocked } = useDraftDecision();
  const expand = (): void => { onExpandedChange(true); };
  // In the split layout the toggle moves between the pool toolbar (expanded) and the heading row (collapsed);
  // focus follows it so keyboard users never land on hidden content.
  const toggleRef = React.useRef<HTMLElement>(null);
  const toggledByUser = React.useRef(false);
  React.useEffect(() => {
    if (!toggledByUser.current) return;
    toggledByUser.current = false;
    toggleRef.current?.focus();
  }, [isExpanded]);

  const collapseButton = (
    <Button ref={toggleRef} variant="ghost" size="sm" className="draft-dock-toggle shrink-0 rounded-sm" aria-expanded={isExpanded}
      aria-label={isExpanded ? 'Collapse player workspace' : 'Expand player workspace'}
      title={isExpanded ? 'Collapse player workspace' : 'Expand player workspace'}
      onClick={() => { toggledByUser.current = true; onExpandedChange(!isExpanded); }}>
      {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      <span className="draft-dock-toggle-label hidden sm:inline">{isExpanded ? 'Collapse' : 'Expand'}</span>
    </Button>
  );
  const rosterTab = <DockTab value="roster" label="Roster" count={`${String(rosterCount)} / ${String(totalRounds)}`} />;
  const queueTab = <DockTab value="queue" label="Queue" count={<span aria-live="polite">{String(queuedCount)}</span>} />;
  const suggestionsTab = (
    <DockTab value="suggestions" label="Suggestions" count={String(Math.min(SUGGESTION_COUNT, overall.recommendations.length))} />
  );
  const secondaryPanels = (
    <>
      <TabsContent value="roster" className="draft-dock-panel">
        <DraftRosterPanel />
      </TabsContent>
      <TabsContent value="queue" className="draft-dock-panel">
        <DraftQueuePanel />
      </TabsContent>
      <TabsContent value="suggestions" className="draft-dock-panel @container">
        <div className="suggestion-dock-heading">
          <h3>Suggested picks</h3>
          <SuggestionShortcutHint />
        </div>
        <DraftSuggestions onOpenAssistant={onOpenAssistant} />
      </TabsContent>
    </>
  );

  return (
    <section className={cn('draft-dock', isSplit && 'is-split', !isExpanded && 'is-collapsed')} aria-label="Draft tools">
      <h2 className="sr-only">Draft workspace</h2>
      <p className="sr-only">Player pool ordered by {recommendationsBlocked ? RANKING_LABELS.long : output.selectedLens === 'best-pick' ? 'Best Pick' : 'Best Player'}</p>
      {checklist ? <div className="draft-dock-checklist">{checklist}</div> : null}
      {isSplit ? (
        <>
          <div className="draft-dock-pool">
            {/* Expanded, the title and toggle share the pool toolbar's row, which leaves laptop heights room for more rows. */}
            {isExpanded ? null : (
              <div className="draft-dock-heading">
                <h3>Available players</h3>
                {collapseButton}
              </div>
            )}
            <MotionExpandable open={isExpanded}>
              <div className="draft-dock-panel is-pool">
                <DraftPlayerPool
                  onRevealRequest={expand}
                  heading={<h3 className="draft-pool-title">Available players</h3>}
                  toolbarEnd={isExpanded ? collapseButton : null}
                />
              </div>
            </MotionExpandable>
          </div>
          <Tabs defaultValue="roster" className="draft-dock-side gap-0" onValueChange={expand}>
            <TabsList className="draft-dock-tabs">
              {rosterTab}
              {queueTab}
              {suggestionsTab}
            </TabsList>
            <MotionExpandable open={isExpanded}>
              {secondaryPanels}
            </MotionExpandable>
          </Tabs>
        </>
      ) : (
        <Tabs defaultValue="players" className="gap-0" onValueChange={expand}>
          <div className="draft-dock-heading is-tabs">
            <TabsList className="draft-dock-tabs">
              <DockTab value="players" label="Players" />
              {rosterTab}
              {queueTab}
              {suggestionsTab}
            </TabsList>
            {collapseButton}
          </div>
          <MotionExpandable open={isExpanded}>
            <TabsContent value="players" className="draft-dock-panel">
              <DraftPlayerPool onRevealRequest={expand} />
            </TabsContent>
            {secondaryPanels}
          </MotionExpandable>
        </Tabs>
      )}
    </section>
  );
}
