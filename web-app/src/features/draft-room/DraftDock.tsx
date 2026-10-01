import * as React from 'react';
import { ChevronDown, ChevronUp, Lightbulb, ListOrdered, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { MotionCount, MotionExpandable } from '@/components/motion';
import { WorkspacePanelSkeleton } from '@/components/skeletons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useDraftStore } from '@/stores/draftStore';
import { DraftPlayerPool } from './DraftPlayerPool';

const DraftSuggestions = React.lazy(() =>
  import('./DraftSuggestions').then((module) => ({ default: module.DraftSuggestions }))
);

const DraftQueuePanel = React.lazy(() =>
  import('./DraftQueuePanel').then((module) => ({ default: module.DraftQueuePanel }))
);

const DraftRosterPanel = React.lazy(() =>
  import('./DraftRosterPanel').then((module) => ({ default: module.DraftRosterPanel }))
);

function WorkspacePanelLoading(): React.ReactElement {
  return <WorkspacePanelSkeleton />;
}

export function DraftDock({
  onOpenAssistant,
}: {
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = React.useState(true);
  const queuedCount = useDraftStore((state) => state.shortlistedPlayerIds.length);
  const rosterCount = useDraftStore((state) =>
    (Object.values(state.myRoster) as string[][]).reduce(
      (total, playerIds) => total + playerIds.length,
      0
    )
  );
  const { output, overall } = useDraftDecision();

  return (
    <section className="draft-dock overflow-hidden border-y border-border/70" aria-label="Draft tools">
      <h2 className="sr-only">Draft workspace</h2>
      <p className="sr-only">Player pool ordered by {output.selectedLens === 'best-pick' ? 'Best Pick' : 'Best Player'}</p>
      <Tabs defaultValue="players" className="gap-0" onValueChange={() => { setIsExpanded(true); }}>
        <div className="flex min-w-0 items-center border-b border-border/70">
          <TabsList className="h-11 min-w-0 flex-1 justify-start overflow-x-auto rounded-none bg-transparent p-0">
            <TabsTrigger value="players" className="h-full min-w-28 flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:text-emerald-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-emerald-300">
              <Search className="size-4" /> Players
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="h-full min-w-32 flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:text-emerald-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-emerald-300">
              <Lightbulb className="size-4" /> Suggestions
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {String(Math.min(3, overall.recommendations.length))}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="queue" className="h-full min-w-28 flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:text-emerald-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-emerald-300">
              <ListOrdered className="size-4" /> Queue
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                <MotionCount value={queuedCount} />
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="roster" className="h-full min-w-28 flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:text-emerald-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-emerald-300">
              <Users className="size-4" /> Roster
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {String(rosterCount)}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" className="shrink-0" aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse player workspace' : 'Expand player workspace'}
            onClick={() => { setIsExpanded((current) => !current); }}>
            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            <span className="hidden sm:inline">{isExpanded ? 'Collapse' : 'Expand'}</span>
          </Button>
        </div>
        <MotionExpandable open={isExpanded}>
          <TabsContent value="players" className="p-3">
            <DraftPlayerPool />
          </TabsContent>
          <TabsContent value="suggestions" className="p-3">
            <React.Suspense fallback={<WorkspacePanelLoading />}>
              <DraftSuggestions onOpenAssistant={onOpenAssistant} />
            </React.Suspense>
          </TabsContent>
          <TabsContent value="queue" className="p-3">
            <React.Suspense fallback={<WorkspacePanelLoading />}>
              <DraftQueuePanel />
            </React.Suspense>
          </TabsContent>
          <TabsContent value="roster" className="p-3">
            <React.Suspense fallback={<WorkspacePanelLoading />}>
              <DraftRosterPanel />
            </React.Suspense>
          </TabsContent>
        </MotionExpandable>
      </Tabs>
    </section>
  );
}
