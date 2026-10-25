import { useDraftState } from '@/workspace/WorkspaceProvider';
import { POSITIONS } from '@fantasy-draft/shared/league';
import { useDraftView } from '@/workspace/useDraftView';
import { RANKING_LABELS } from '@/lib/demo-mode';
import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { MotionCount, MotionExpandable } from '@/components/motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { DraftPlayerPool } from './DraftPlayerPool';
import { DraftQueuePanel } from './DraftQueuePanel';
import { DraftRosterPanel } from './DraftRosterPanel';
import { DraftSuggestions } from './DraftSuggestions';

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
  // The checklist's height adds to the dock's minimum, so the pool keeps its rows and the workspace scrolls instead.
  const checklistRef = React.useRef<HTMLDivElement>(null);
  const [checklistHeight, setChecklistHeight] = React.useState(0);
  const hasChecklist = Boolean(checklist);
  React.useLayoutEffect(() => {
    const element = checklistRef.current;
    if (!hasChecklist || !element) {
      setChecklistHeight(0);
      return undefined;
    }
    const update = (): void => { setChecklistHeight(Math.ceil(element.getBoundingClientRect().height)); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [hasChecklist]);

  const collapseButton = (
    <Button variant="ghost" size="sm" className="shrink-0 rounded-sm" aria-expanded={isExpanded}
      aria-label={isExpanded ? 'Collapse player workspace' : 'Expand player workspace'}
      onClick={() => { onExpandedChange(!isExpanded); }}>
      {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      <span className="hidden sm:inline">{isExpanded ? 'Collapse' : 'Expand'}</span>
    </Button>
  );
  const rosterTab = <DockTab value="roster" label="Roster" count={`${String(rosterCount)} / ${String(totalRounds)}`} />;
  const queueTab = <DockTab value="queue" label="Queue" count={<MotionCount value={queuedCount} />} />;
  const suggestionsTab = (
    <DockTab value="suggestions" label="Suggestions" count={String(Math.min(3, overall.recommendations.length))} />
  );
  const secondaryPanels = (
    <>
      <TabsContent value="roster" className="draft-dock-panel">
        <DraftRosterPanel />
      </TabsContent>
      <TabsContent value="queue" className="draft-dock-panel">
        <DraftQueuePanel />
      </TabsContent>
      <TabsContent value="suggestions" className="draft-dock-panel">
        <DraftSuggestions onOpenAssistant={onOpenAssistant} />
      </TabsContent>
    </>
  );

  return (
    <section
      className={cn('draft-dock', isSplit && 'is-split', !isExpanded && 'is-collapsed')}
      aria-label="Draft tools"
      style={checklistHeight > 0 ? { '--draft-dock-checklist-height': `${String(checklistHeight)}px` } as React.CSSProperties : undefined}
    >
      <h2 className="sr-only">Draft workspace</h2>
      <p className="sr-only">Player pool ordered by {recommendationsBlocked ? RANKING_LABELS.long : output.selectedLens === 'best-pick' ? 'Best Pick' : 'Best Player'}</p>
      {checklist ? <div ref={checklistRef} className="draft-dock-checklist">{checklist}</div> : null}
      {isSplit ? (
        <>
          <div className="draft-dock-pool">
            <div className="draft-dock-heading">
              <h3>Available players</h3>
              {collapseButton}
            </div>
            <MotionExpandable open={isExpanded}>
              <div className="draft-dock-panel">
                <DraftPlayerPool />
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
              <DraftPlayerPool />
            </TabsContent>
            {secondaryPanels}
          </MotionExpandable>
        </Tabs>
      )}
    </section>
  );
}
