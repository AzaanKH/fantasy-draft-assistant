import { sendWorkspaceCommand } from '@/workspace/workspace-command';
import { useWorkspace, useDraftSessionMode, useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { POSITIONS, type Player, type Position } from '@fantasy-draft/shared/league';
import { createSlotSequence, type PoolSort } from '@fantasy-draft/shared/draft';
import { Button } from '@/components/ui/button';
import { type AssistantLens } from '@/features/assistant/assistant-navigation';
import { DraftReadinessBlockedNotice } from '@/features/draft-room/DraftReadinessBlockedNotice';
import { useLiveDraftSync } from '@/features/draft-room/LiveDraftSyncProvider';
import { ProviderIdentityBlockedNotice } from '@/features/draft-room/ProviderIdentityBlockedNotice';
import { DraftSuggestions } from '@/features/draft-room/DraftSuggestions';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useTeamNeeds } from '@/hooks/useTeamNeeds';
import { ArrowLeft, X } from 'lucide-react';
import * as React from 'react';
import { AssistantContextBar, AssistantTopPick } from './AssistantContextBar';
import { AssistantSkeleton, AssistantViewTabs, LeadHeading, SuggestionsLayout } from './AssistantLayout';
import { AssistantQueue, AssistantRailSummary, AssistantRoster, UpcomingPicks } from './AssistantRail';
import { AssistantAnalysisPanel } from './AssistantAnalysisPanel';
import { AssistantPool, AssistantSearch, type PositionFilter } from './AssistantPool';
import { collectRecommendations } from './assistant-pool';
import { PositionTiersView } from './PositionTiersView';
import { AssistantDataProvider, type AssistantData } from './AssistantDataContext';
import { useTierDrawer } from './useTierDrawer';
import { useAssistantSubject } from './useAssistantSubject';
import {
  getAlertSignals,
  getAssistantDraftMode,
  getPickWindow,
  getUpcomingTeamPicks,
} from './assistant-context';
import { useCollapsedPlayerCount } from './useAssistantLayout';

export type { PositionFilter } from './AssistantPool';

export function AssistantPage({
  initialLens = 'why',
  initialSelectedPlayerId = null,
  onReturnToDraft,
}: {
  readonly initialLens?: AssistantLens;
  readonly initialSelectedPlayerId?: string | null;
  readonly onReturnToDraft: () => void;
}): React.ReactElement {
  const [view, setViewState] = React.useState<'suggestions' | 'tiers'>('suggestions');
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const deferredSearch = React.useDeferredValue(searchQuery.trim().toLowerCase());
  const [poolSort, setPoolSort] = React.useState<PoolSort>('recommendation');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const tiersRef = React.useRef<HTMLDivElement>(null);
  // The tier view keeps its cheat sheet mounted and opens the analysis beside it.
  const tierDrawer = useTierDrawer(tiersRef);
  const resetTierDrawer = tierDrawer.reset;
  // Switching views drops the tier analysis, so a stale analysis for an old player never reopens.
  const setView = React.useCallback((next: 'suggestions' | 'tiers') => {
    setViewState(next);
    resetTierDrawer();
  }, [resetTierDrawer]);
  const collapsedPlayerCount = useCollapsedPlayerCount();
  const decision = useDraftDecision();
  const liveSync = useLiveDraftSync();
  const { players } = usePlayerDataQuery();
  const { needs } = useTeamNeeds();
  const sessionMode = useDraftSessionMode();
  const config = useDraftState((state) => state.config);
  const currentPick = useDraftView((view) => view.currentPick);
  const draftHistory = useDraftState((state) => state.draftHistory);
  const teamRosters = useDraftView((view) => view.teamRosters);
  const draftedPlayerIds = useDraftView((view) => view.draftedPlayerIds);
  const available = useDraftView((view) => view.available);
  const myRoster = useDraftView((view) => view.myRoster);
  const decisionLens = useDraftState((state) => state.decisionLens);
  const queuedPlayerIds = useDraftView((view) => view.shortlistedPlayerIds);
  const workspace = useWorkspace();
  const { togglePlayerQueued, removePlayerFromQueue } = useQueueActions(players);

  const playerById = React.useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const overall = decision.overall;
  const recommendationById = React.useMemo(
    () => collectRecommendations(overall, decision.byPosition, POSITIONS),
    [decision.byPosition, overall]
  );

  const pickWindow = getPickWindow(currentPick, config.totalTeams, config.totalRounds, config.myPickPosition, config.draftType);
  const finalPick = pickWindow.nextPick === null;
  const nextPickLabel = pickWindow.nextPick === null ? null : createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).label(pickWindow.nextPick);
  const upcomingTeams = getUpcomingTeamPicks({
    picks: pickWindow.picksBetween,
    totalTeams: config.totalTeams,
    draftType: config.draftType,
    teamRosters,
    rosterRequirements: config.rosterRequirements,
    draftHistory,
  });
  const mode = getAssistantDraftMode(sessionMode, liveSync.synchronizationState);
  const sync = {
    mode,
    provider: liveSync.connection?.provider ?? null,
    synchronizationState: liveSync.synchronizationState,
    lastConfirmedPickNumber: liveSync.lastConfirmedPickNumber,
    lastSuccessfulSyncAt: liveSync.viewState.lastSuccessfulSyncAt,
    draftType: config.draftType,
    totalTeams: config.totalTeams,
  };

  const rosteredPlayers = React.useMemo(
    () => POSITIONS.map(position => myRoster[position]).flat().map((id) => playerById.get(id)).filter((player): player is Player => player !== undefined),
    [myRoster, playerById]
  );
  const rosterNames = React.useMemo(() => {
    const names: Partial<Record<Position, string[]>> = {};
    rosteredPlayers.forEach((player) => { (names[player.position] ??= []).push(player.name); });
    return names;
  }, [rosteredPlayers]);
  const draftedPickLabels = React.useMemo(() => {
    const order = createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds });
    return new Map(draftHistory.map((pick) => [
      pick.playerId,
      `${order.label(pick.pickNumber)} · ${pick.teamIndex === config.myPickPosition - 1 ? 'My Team' : pick.teamName || `Team ${String(pick.teamIndex + 1)}`}`,
    ]));
  }, [config.draftType, config.myPickPosition, config.totalRounds, config.totalTeams, draftHistory]);
  // Every available player's alerts, once per draft change: rows and the analysis read this map, never recompute.
  const alertsById = React.useMemo(() => {
    const recentPicks = [...draftHistory].sort((first, second) => first.pickNumber - second.pickNumber);
    return new Map(available.map((player) => [player.id, getAlertSignals({ player, rosteredPlayers, recentPicks, currentPick })]));
  }, [available, currentPick, draftHistory, rosteredPlayers]);
  const availabilityById = decision.nextPickAvailabilityById;
  const bestPickId = decision.output.bestPick?.playerId;
  const assistantData = React.useMemo((): AssistantData => ({
    players, playerById, available, draftedPlayerIds, draftedPickLabels, overall, byPosition: decision.byPosition, recommendationById,
    availabilityById, alertsById, queuedSet, needs, bestPickId, finalPick, nextPickLabel, mode,
    rosterSize: rosteredPlayers.length, totalRounds: config.totalRounds, totalTeams: config.totalTeams, onQueue: togglePlayerQueued,
  }), [alertsById, available, availabilityById, bestPickId, config.totalRounds, config.totalTeams, decision.byPosition, draftedPickLabels,
    draftedPlayerIds, finalPick, mode, needs, nextPickLabel, overall, playerById, players, queuedSet, recommendationById,
    rosteredPlayers.length, togglePlayerQueued]);

  const subject = useAssistantSubject({
    initialSelectedPlayerId,
    initialLens,
    overall,
    output: decision.output,
    lens: decisionLens,
    recommendationById,
    playerById,
    draftedPlayerIds,
    alertsById,
    rosteredPlayers,
    queuedSet,
    availabilityById,
    finalPick,
  });
  const { select: handleSelectPlayer, explain } = subject;
  /** A card's "Full reasoning": the Why tab, with the reasoning open, beside the cards. */
  const explainPlayer = React.useCallback((playerId: string) => { explain(playerId, { expand: true, reveal: false }); }, [explain]);
  const openTierDrawer = tierDrawer.open;
  const openTierAnalysis = React.useCallback((playerId: string, origin: HTMLElement) => {
    openTierDrawer(origin);
    explain(playerId);
  }, [explain, openTierDrawer]);
  const focusFirstResult = React.useCallback(() => {
    document.querySelector<HTMLButtonElement>('.rec-pool-list [data-pool-select]')?.focus();
  }, []);

  if (decision.recommendationsBlockedByProviderIdentity) {
    return (
      <main className="assistant-workspace rec-workspace" data-suggestion-keys="">
        <Button variant="outline" size="sm" onClick={onReturnToDraft}>
          <ArrowLeft className="size-4" /> Return to Draft Workspace
        </Button>
        <ProviderIdentityBlockedNotice unresolvedPicks={decision.unresolvedProviderPicks} totalTeams={config.totalTeams} draftType={config.draftType} className="mx-auto mt-4 max-w-3xl" />
      </main>
    );
  }

  // The lazy page's own skeleton, so a ranking refresh never swaps the layout for a centered message.
  if (decision.isLoading) return <AssistantSkeleton analysisTab={subject.tab} />;

  if (decision.recommendationsBlocked && decision.readiness) {
    return (
      <main className="assistant-workspace rec-workspace" data-suggestion-keys="">
        <Button variant="outline" size="sm" onClick={onReturnToDraft}>
          <ArrowLeft className="size-4" /> Return to Draft Workspace
        </Button>
        <DraftReadinessBlockedNotice readiness={decision.readiness} className="mx-auto mt-4 max-w-3xl" />
      </main>
    );
  }

  const topSuggestion = overall.recommendations[0];
  const analysisSection = (
    <AssistantAnalysisPanel
      ref={subject.analysisRef}
      subject={subject.subject}
      lens={decisionLens}
      tab={subject.tab}
      onTabChange={subject.setTab}
      onViewPlayer={handleSelectPlayer}
      onComparisonPlayerChange={subject.setComparisonPlayerId}
      onQueue={togglePlayerQueued}
      draft={{ mode, provider: liveSync.connection?.provider ?? null, nextPickLabel, quietAction: view === 'tiers' ? topSuggestion !== undefined : !deferredSearch }}
      decision={overall}
      playerById={playerById}
      needs={needs}
    />
  );

  return (
    <AssistantDataProvider value={assistantData}>
    <main className="assistant-workspace rec-workspace" data-suggestion-keys="">
      <AssistantContextBar
        tabs={<AssistantViewTabs view={view} onChange={setView} />}
        topPick={view === 'tiers' && topSuggestion ? (
          <AssistantTopPick
            recommendation={topSuggestion}
            player={playerById.get(topSuggestion.playerId)}
            draft={{ mode, provider: liveSync.connection?.provider ?? null, nextPickLabel }}
            onSelect={openTierAnalysis}
          />
        ) : null}
        pickWindow={pickWindow}
        totalTeams={config.totalTeams} draftType={config.draftType}
        sync={sync}
        lens={decisionLens}
        onLensChange={(lens) => {
          decision.setSelectedLens(lens);
          subject.reset();
        }}
      />

      {view === 'tiers' ? (
        <div ref={tiersRef} id="rec-view-panel-tiers" role="tabpanel" aria-labelledby="rec-view-tiers" className="rec-tiers-layout" data-analysis={tierDrawer.isOpen || undefined}>
          <PositionTiersView
            selectedPlayerId={tierDrawer.isOpen ? subject.viewedPlayerId : undefined}
            onSelect={openTierAnalysis}
          />
          {tierDrawer.isOpen ? (
            // A sheet beside the cheat sheet, not an overlay: nothing sits underneath the analysis (and nothing hidden
            // can take focus). Escape closes it and returns focus to the row that opened it.
            <aside className="rec-tiers-analysis" aria-label="Tier player analysis"
              onKeyDown={(event) => {
                if (event.key !== 'Escape' || event.defaultPrevented) return;
                event.preventDefault();
                tierDrawer.close();
              }}>
              <Button variant="ghost" size="sm" className="rec-tiers-analysis-close" aria-keyshortcuts="Escape" onClick={tierDrawer.close}>
                <X className="size-4" aria-hidden="true" /> Close analysis
              </Button>
              {analysisSection}
            </aside>
          ) : null}
        </div>
      ) : (
      <SuggestionsLayout
        main={(<>
          <LeadHeading lens={decisionLens} cardsShown={!deferredSearch}
            search={<AssistantSearch ref={searchRef} value={searchQuery} onChange={setSearchQuery} onArrowDown={focusFirstResult} />} />

          {/* A search replaces the four cards with its matches, directly under the search box; clearing it brings them back. */}
          {deferredSearch ? null : (
            <DraftSuggestions
              variant="assistant"
              selectedPlayerId={subject.viewedPlayerId}
              onSelect={handleSelectPlayer}
              onExplain={explainPlayer}
            />
          )}

          <AssistantPool
            search={{ query: searchQuery, deferredQuery: deferredSearch, ref: searchRef }}
            positionFilter={positionFilter}
            onPositionFilterChange={setPositionFilter}
            sort={poolSort}
            onSortChange={setPoolSort}
            selection={{ highlightedPlayerIds: subject.highlightedPlayerIds, label: subject.selectionLabel }}
            collapsedCount={collapsedPlayerCount}
            onSelect={handleSelectPlayer}
          />
        </>)}
        analysis={analysisSection}
        summary={(
          <AssistantRailSummary
            nextPickLabel={nextPickLabel}
            queueCount={queuedPlayerIds.length}
            upcomingTeams={upcomingTeams}
          />
        )}
        rail={(<>
          <AssistantQueue
            queuedPlayerIds={queuedPlayerIds}
            playerById={playerById}
            recommendationById={recommendationById}
            bestPick={decision.output.bestPick}
            nextPickLabel={nextPickLabel}
            mode={mode}
            provider={liveSync.connection?.provider ?? null}
            onMove={(...args) => { sendWorkspaceCommand(workspace, 'moveShortlistedPlayer', ...args); }}
            onRemove={removePlayerFromQueue}
            onSelect={handleSelectPlayer}
          />
          <UpcomingPicks
            teams={upcomingTeams}
            nextPickLabel={nextPickLabel}
            viewedPosition={subject.viewedPosition}
          />
          <AssistantRoster
            needs={needs}
            rosterNames={rosterNames}
            rosterSize={rosteredPlayers.length}
            totalRounds={config.totalRounds}
          />
        </>)}
      />
      )}
    </main>
    </AssistantDataProvider>
  );
}
