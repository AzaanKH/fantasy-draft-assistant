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
    <section className="overflow-hidden border-y border-border/70" aria-label="Draft tools">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-2">
        <div>
          <h2 className="text-sm font-bold">Draft workspace</h2>
          <p className="text-[11px] text-muted-foreground">
            Player pool ordered by {output.selectedLens === 'best-pick' ? 'Best Pick' : 'Best Player'} · suggestions, local shortlist, and roster
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={isExpanded}
          onClick={() => { setIsExpanded((current) => !current); }}
        >
          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {isExpanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>
      <MotionExpandable open={isExpanded}>
        <Tabs defaultValue="players" className="gap-0">
        <TabsList className="h-11 w-full justify-start overflow-x-auto rounded-none border-b border-border/70 bg-transparent p-0">
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
        </Tabs>
      </MotionExpandable>
    </section>
  );
}
