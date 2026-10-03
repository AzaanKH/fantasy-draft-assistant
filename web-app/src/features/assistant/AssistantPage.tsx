import { DecisionSwap } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { AssistantLens } from '@/features/assistant/assistant-navigation';
import { getPositionRecommendations } from '@/features/assistant/assistant-position-rankings';
import { DraftReadinessBlockedNotice } from '@/features/draft-room/DraftReadinessBlockedNotice';
import { useLiveDraftSync } from '@/features/draft-room/LiveDraftSyncProvider';
import { ProviderIdentityBlockedNotice } from '@/features/draft-room/ProviderIdentityBlockedNotice';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useTeamNeeds } from '@/hooks/useTeamNeeds';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { useDraftSessionMode, useDraftStore, useIsMyTurn } from '@/stores/draftStore';
import { POSITIONS, type Player, type Position, type Recommendation } from '@fantasy-draft/shared';
import { ArrowLeft, ChevronDown, ChevronUp, Search } from 'lucide-react';
import * as React from 'react';

import { AssistantContextBar } from './AssistantContextBar';
import { AssistantQueue, AssistantRoster, UpcomingPicks } from './AssistantRail';
import { RosterAnswer, WaitAnswer, WhyAnswer } from './AssistantAnswers';
import { CompareAnswer } from './AssistantComparison';
import { AssistantRecommendationRow, CandidateRowHeader } from './AssistantRecommendationRow';
import { PositionTiersView } from './PositionTiersView';
import { PreferredPickCard, type LensDivergence } from './PreferredPickCard';
import { PoolSort, sortRecommendationsForPool } from './assistant-analysis';
import {
  countTeamsNeeding,
  getAlertSignals,
  getAssistantDraftMode,
  getPickWindow,
  getSyncStatus,
  getUpcomingTeamPicks,
} from './assistant-context';
import { useCollapsedPlayerCount } from './useAssistantLayout';
import './assistant.css';

export type PositionFilter = 'ALL' | Position;

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', ...POSITIONS];
const OTHER_OPTION_COUNT = 4;
const ANALYSIS_TABS: readonly { readonly id: AssistantLens; readonly label: string }[] = [
  { id: 'why', label: 'Why this player?' },
  { id: 'compare', label: 'Compare options' },
  { id: 'wait', label: 'Can I wait?' },
  { id: 'roster', label: 'What does my roster need?' },
];

export function AssistantPage({
  initialLens = 'why',
  initialSelectedPlayerId = null,
  onReturnToDraft,
}: {
  readonly initialLens?: AssistantLens;
  readonly initialSelectedPlayerId?: string | null;
  readonly onReturnToDraft: () => void;
}): React.ReactElement {
  const [view, setView] = React.useState<'suggestions' | 'tiers'>('suggestions');
  const [analysisTab, setAnalysisTab] = React.useState<AssistantLens>(initialLens);
  const [showAllPlayers, setShowAllPlayers] = React.useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = React.useState<string | null>(initialSelectedPlayerId);
  const [comparisonPlayerId, setComparisonPlayerId] = React.useState<string | null>(null);
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const deferredSearch = React.useDeferredValue(searchQuery.trim().toLowerCase());
  const [poolSort, setPoolSort] = React.useState<PoolSort>('recommendation');
  const analysisRef = React.useRef<HTMLElement>(null);
  const collapsedPlayerCount = useCollapsedPlayerCount();
  const decision = useDraftDecision();
  const liveSync = useLiveDraftSync();
  const { players } = usePlayerDataQuery();
  const { needs } = useTeamNeeds();
  const { canDraft, isMyTurn: canPickNow, draftPlayer } = useDraftPlayerAction();
  const isMyTurn = useIsMyTurn();
  const sessionMode = useDraftSessionMode();
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const teamRosters = useDraftStore((state) => state.teamRosters);
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const myRoster = useDraftStore((state) => state.myRoster);
  const decisionLens = useDraftStore((state) => state.decisionLens);
  const queuedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const moveShortlistedPlayer = useDraftStore((state) => state.moveShortlistedPlayer);
  const { togglePlayerQueued, removePlayerFromQueue } = useQueueActions(players);

  const playerById = React.useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const overall = decision.overall;
  const recommendationById = React.useMemo(() => {
    const byId = new Map<string, Recommendation>();
    overall.recommendations.forEach((recommendation) => byId.set(recommendation.playerId, recommendation));
    POSITIONS.forEach((position) => {
      decision.byPosition[position].recommendations.forEach((recommendation) => {
        if (!byId.has(recommendation.playerId)) byId.set(recommendation.playerId, recommendation);
      });
    });
    return byId;
  }, [decision.byPosition, overall.recommendations]);

  const poolDecision = positionFilter === 'ALL' ? overall : decision.byPosition[positionFilter];
  const poolCandidates = positionFilter === 'ALL' ? poolDecision.recommendations : getPositionRecommendations(poolDecision);
  const poolRecommendations = React.useMemo(
    () => sortRecommendationsForPool(poolCandidates, poolSort).filter((recommendation) =>
      !deferredSearch || `${recommendation.playerName} ${playerById.get(recommendation.playerId)?.team ?? ''}`.toLowerCase().includes(deferredSearch)
    ),
    [poolCandidates, poolSort, deferredSearch, playerById]
  );

  const leader = overall.preferred;
  const bestPickId = decision.output.bestPick?.playerId;
  const selectedRecommendation = (selectedPlayerId ? recommendationById.get(selectedPlayerId) : undefined) ?? leader ?? undefined;
  const otherOptions = overall.recommendations.filter((recommendation) => recommendation.playerId !== leader?.playerId).slice(0, OTHER_OPTION_COUNT);
  const availableComparisons = selectedRecommendation
    ? overall.recommendations.filter((recommendation) => recommendation.playerId !== selectedRecommendation.playerId)
    : [];
  const comparisonRecommendation = availableComparisons.find((recommendation) => recommendation.playerId === comparisonPlayerId)
    ?? (selectedRecommendation?.playerId === leader?.playerId ? availableComparisons[0] : leader ?? undefined);
  const comparisonRecommendations: readonly Recommendation[] = selectedRecommendation && comparisonRecommendation
    ? [selectedRecommendation, comparisonRecommendation]
    : selectedRecommendation ? [selectedRecommendation] : [];

  const pickWindow = getPickWindow(currentPick, config.totalTeams, config.totalRounds, config.myPickPosition, config.draftType);
  const nextPickLabel = pickWindow.nextPick === null ? null : formatRoundPick(pickWindow.nextPick, config.totalTeams);
  const upcomingTeams = getUpcomingTeamPicks({
    picks: pickWindow.picksBetween,
    totalTeams: config.totalTeams,
    draftType: config.draftType,
    teamRosters,
    rosterRequirements: config.rosterRequirements,
    draftHistory,
  });
  const mode = getAssistantDraftMode(sessionMode, liveSync.synchronizationState);
  const sync = getSyncStatus({
    mode,
    provider: liveSync.connection?.provider ?? null,
    synchronizationState: liveSync.synchronizationState,
    lastConfirmedPickNumber: liveSync.lastConfirmedPickNumber,
    lastSyncAgeMs: liveSync.viewState.lastSyncAgeMs,
    totalTeams: config.totalTeams,
  });

  const rosteredPlayers = React.useMemo(
    () => (Object.values(myRoster) as string[][]).flat().map((id) => playerById.get(id)).filter((player): player is Player => player !== undefined),
    [myRoster, playerById]
  );
  const rosterNames = React.useMemo(() => {
    const names: Partial<Record<Position, string[]>> = {};
    rosteredPlayers.forEach((player) => { (names[player.position] ??= []).push(player.name); });
    return names;
  }, [rosteredPlayers]);
  const recentPicks = React.useMemo(
    () => [...draftHistory].sort((first, second) => first.pickNumber - second.pickNumber),
    [draftHistory]
  );
  const alertsFor = (playerId: string): readonly string[] => getAlertSignals({
    player: playerById.get(playerId),
    rosteredPlayers,
    recentPicks,
    currentPick,
  });

  const handleSelectPlayer = React.useCallback((playerId: string): void => {
    setSelectedPlayerId(playerId);
    setComparisonPlayerId(null);
  }, []);
  const openAnalysis = React.useCallback((tab: AssistantLens): void => {
    setAnalysisTab(tab);
    window.requestAnimationFrame(() => {
      analysisRef.current?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  if (decision.recommendationsBlockedByProviderIdentity) {
    return (
      <main className="assistant-workspace rec-workspace">
        <Button variant="outline" size="sm" onClick={onReturnToDraft}>
          <ArrowLeft className="size-4" /> Return to Draft Workspace
        </Button>
        <ProviderIdentityBlockedNotice unresolvedPicks={decision.unresolvedProviderPicks} totalTeams={config.totalTeams} className="mx-auto mt-4 max-w-3xl" />
      </main>
    );
  }

  if (decision.isLoading) {
    return (
      <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-background text-sm text-muted-foreground">
        Updating league-aware rankings…
      </main>
    );
  }

  if (decision.recommendationsBlocked && decision.readiness) {
    return (
      <main className="assistant-workspace rec-workspace">
        <Button variant="outline" size="sm" onClick={onReturnToDraft}>
          <ArrowLeft className="size-4" /> Return to Draft Workspace
        </Button>
        <DraftReadinessBlockedNotice readiness={decision.readiness} className="mx-auto mt-4 max-w-3xl" />
      </main>
    );
  }

  const lensLabel = decisionLens === 'best-pick' ? 'Best Pick' : 'Best Player';
  const otherLeader = decisionLens === 'best-pick' ? decision.output.bestPlayer : decision.output.bestPick;
  const divergence: LensDivergence | null = leader && otherLeader && otherLeader.playerId !== leader.playerId
    ? {
        label: decisionLens === 'best-pick' ? 'Best Player' : 'Best Pick',
        playerId: otherLeader.playerId,
        playerName: otherLeader.playerName,
        position: otherLeader.position,
        reason: decision.output.decisionDivergenceExplanation,
      }
    : null;
  const leaderPlayer = leader ? playerById.get(leader.playerId) : undefined;
  const selectedPlayer = selectedRecommendation ? playerById.get(selectedRecommendation.playerId) : undefined;
  const sameByeName = selectedPlayer
    ? rosteredPlayers.find((rostered) => rostered.id !== selectedPlayer.id && rostered.position === selectedPlayer.position && rostered.byeWeek === selectedPlayer.byeWeek)?.name ?? null
    : null;
  const teamsNeedingSelected = selectedRecommendation && upcomingTeams.length > 0
    ? (() => {
        const needing = countTeamsNeeding(upcomingTeams, selectedRecommendation.position);
        return needing > 0
          ? `${selectedRecommendation.position} is open for ${String(needing)} of ${String(upcomingTeams.length)} teams before ${nextPickLabel ?? 'your next pick'}.`
          : `No team before ${nextPickLabel ?? 'your next pick'} has an open ${selectedRecommendation.position} starter slot.`;
      })()
    : null;
  const disabledReason = mode === 'mock' && !canDraft
    ? canPickNow ? 'A keeper occupies this pick.' : 'Waiting for your turn.'
    : null;
  const cards = showAllPlayers ? poolRecommendations : poolRecommendations.slice(0, collapsedPlayerCount * 2);
  const hiddenPlayerCount = poolRecommendations.length - cards.length;
  const selectedTabIndex = ANALYSIS_TABS.findIndex((tab) => tab.id === analysisTab);

  return (
    <main className="assistant-workspace rec-workspace">
      <AssistantContextBar
        isMyTurn={isMyTurn}
        pickWindow={pickWindow}
        totalTeams={config.totalTeams}
        mode={mode}
        sync={sync}
        lens={decisionLens}
        onLensChange={(lens) => {
          decision.setSelectedLens(lens);
          setSelectedPlayerId(null);
          setComparisonPlayerId(null);
        }}
      />

      <div
        className="rec-tabs rec-view-tabs"
        role="tablist"
        aria-label="Assistant view"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = view === 'suggestions' ? 'tiers' : 'suggestions';
          const target = event.key === 'Home' ? 'suggestions' : event.key === 'End' ? 'tiers' : next;
          setView(target);
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
            onClick={() => { setView(item); }}
          >
            {item === 'suggestions' ? 'Suggestions' : 'Position tiers'}
          </button>
        ))}
      </div>

      {view === 'tiers' ? (
        <div id="rec-view-panel-tiers" role="tabpanel" aria-labelledby="rec-view-tiers">
          <PositionTiersView
            players={players}
            draftedPlayerIds={draftedPlayerIds}
            recommendationById={recommendationById}
            bestPickId={bestPickId}
            selectedPlayerId={selectedRecommendation?.playerId}
            queuedSet={queuedSet}
            needs={needs}
            nextPickLabel={nextPickLabel}
            onSelect={(playerId) => {
              handleSelectPlayer(playerId);
              setAnalysisTab('why');
              setView('suggestions');
              window.requestAnimationFrame(() => { analysisRef.current?.scrollIntoView({ block: 'nearest' }); });
            }}
            onQueue={togglePlayerQueued}
          />
        </div>
      ) : (
      <div id="rec-view-panel-suggestions" role="tabpanel" aria-labelledby="rec-view-suggestions" className="rec-main">
      <div className="rec-layout">
        <div className="rec-main">
          <div className="rec-section-heading">
            <h1>{decisionLens === 'best-pick' ? 'Your Best Pick' : 'Best Player available'}</h1>
            <span className="rec-muted">
              {decisionLens === 'best-pick' ? 'League value + roster fit + draft timing' : 'Player quality (ECR), without roster or timing'}
            </span>
            <Button variant="ghost" size="sm" className="rec-return" onClick={onReturnToDraft}>
              <ArrowLeft className="size-4" aria-hidden="true" /> Draft board
            </Button>
          </div>

          {leader ? (
            <PreferredPickCard
              recommendation={leader}
              player={leaderPlayer}
              lensLabel={lensLabel}
              alerts={alertsFor(leader.playerId)}
              divergence={divergence}
              isQueued={queuedSet.has(leader.playerId)}
              queuePosition={queuedPlayerIds.indexOf(leader.playerId) + 1}
              action={{
                mode,
                canDraft,
                disabledReason,
                onDraft: () => { if (leaderPlayer) draftPlayer(leaderPlayer); },
                onRecordPick: onReturnToDraft,
              }}
              onQueue={() => { togglePlayerQueued(leader.playerId); }}
              onViewPlayer={(playerId) => { handleSelectPlayer(playerId); openAnalysis('why'); }}
              onCompare={() => { handleSelectPlayer(leader.playerId); openAnalysis('compare'); }}
            />
          ) : (
            <div className="rec-card rec-empty" role="status">No available recommendation for this draft state.</div>
          )}

          <div className="rec-split" data-wide={analysisTab === 'compare'}>
            <section ref={analysisRef} className="rec-analysis" aria-label="Viewed player analysis">
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
                      : (selectedTabIndex + (event.key === 'ArrowRight' ? 1 : -1) + ANALYSIS_TABS.length) % ANALYSIS_TABS.length;
                  const tab = ANALYSIS_TABS[next];
                  if (!tab) return;
                  setAnalysisTab(tab.id);
                  document.getElementById(`rec-tab-${tab.id}`)?.focus();
                }}
              >
                {ANALYSIS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    id={`rec-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={analysisTab === tab.id}
                    aria-controls="rec-analysis-panel"
                    tabIndex={analysisTab === tab.id ? 0 : -1}
                    onClick={() => { setAnalysisTab(tab.id); }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div id="rec-analysis-panel" role="tabpanel" aria-labelledby={`rec-tab-${analysisTab}`} className="rec-answer" aria-live="polite">
                {selectedRecommendation ? (
                  <p className="rec-answer-subject">
                    {selectedRecommendation.playerId === leader?.playerId ? lensLabel : 'Viewing'}: {selectedRecommendation.playerName}
                  </p>
                ) : null}
                <DecisionSwap motionKey={`${analysisTab}:${selectedRecommendation?.playerId ?? 'none'}`}>
                  {!selectedRecommendation ? (
                    <p className="rec-answer-footnote">No available recommendation for this draft state.</p>
                  ) : analysisTab === 'why' ? (
                    <WhyAnswer
                      recommendation={selectedRecommendation}
                      isTopPick={selectedRecommendation.playerId === bestPickId}
                      preferredExplanation={overall.explanationByPlayerId.get(selectedRecommendation.playerId)}
                    />
                  ) : analysisTab === 'compare' ? (
                    <CompareAnswer
                      recommendations={comparisonRecommendations}
                      availableComparisons={availableComparisons}
                      decision={overall}
                      onComparisonPlayerChange={setComparisonPlayerId}
                      playerById={playerById}
                    />
                  ) : analysisTab === 'wait' ? (
                    <WaitAnswer recommendation={selectedRecommendation} teamsNeedingPosition={teamsNeedingSelected} />
                  ) : (
                    <RosterAnswer needs={needs} recommendation={selectedRecommendation} player={selectedPlayer} sameByeName={sameByeName} />
                  )}
                </DecisionSwap>
              </div>
            </section>

            <section className="rec-options" aria-labelledby="rec-options-heading">
              <div className="rec-section-heading">
                <h2 id="rec-options-heading">Other options</h2>
                <span className="rec-muted">Select a player to view</span>
              </div>
              <CandidateRowHeader />
              {otherOptions.map((recommendation, order) => (
                <AssistantRecommendationRow
                  key={recommendation.playerId}
                  recommendation={recommendation}
                  player={playerById.get(recommendation.playerId)}
                  rank={overall.rankByPlayerId.get(recommendation.playerId) ?? order + 2}
                  order={order}
                  isSelected={selectedRecommendation?.playerId === recommendation.playerId}
                  isBestPick={recommendation.playerId === bestPickId}
                  isQueued={queuedSet.has(recommendation.playerId)}
                  alert={alertsFor(recommendation.playerId)[0]}
                  onSelect={handleSelectPlayer}
                  onQueue={togglePlayerQueued}
                />
              ))}
            </section>
          </div>
        </div>

        <aside className="rec-rail" aria-label="Queue, upcoming picks and roster">
          <AssistantQueue
            queuedPlayerIds={queuedPlayerIds}
            playerById={playerById}
            recommendationById={recommendationById}
            bestPick={decision.output.bestPick}
            nextPickLabel={nextPickLabel}
            mode={mode}
            onMove={moveShortlistedPlayer}
            onRemove={removePlayerFromQueue}
            onSelect={handleSelectPlayer}
          />
          <UpcomingPicks
            teams={upcomingTeams}
            pickCount={pickWindow.picksBetween.length}
            nextPickLabel={nextPickLabel}
            viewedPosition={selectedRecommendation?.position ?? null}
          />
          <AssistantRoster
            needs={needs}
            rosterNames={rosterNames}
            rosterSize={rosteredPlayers.length}
            totalRounds={config.totalRounds}
          />
        </aside>
      </div>

      {overall.recommendations.length > 0 ? (
        <section className="rec-pool" aria-labelledby="rec-pool-heading">
          <div className="rec-section-heading">
            <h2 id="rec-pool-heading">{positionFilter === 'ALL' ? 'All recommended players' : `Best available ${positionFilter}s`}</h2>
            <span className="rec-muted">
              {positionFilter === 'ALL'
                ? `Ordered by ${lensLabel}.`
                : `Ranked within ${positionFilter} by the same policy.`}
            </span>
          </div>
          <div className="rec-pool-toolbar">
            <label className="rec-search">
              <Search className="size-4" aria-hidden="true" />
              <span className="sr-only">Search recommended players</span>
              <input value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); }} placeholder="Search player or team" />
            </label>
            <div className="rec-filters" role="group" aria-label="Filter by position">
              {POSITION_FILTERS.map((position) => {
                const need = position === 'ALL' ? undefined : needs.find((item) => item.position === position);
                const filled = position === 'ALL' ? rosteredPlayers.length : need?.startersFilled ?? 0;
                const total = position === 'ALL' ? config.totalRounds : need?.startersNeeded ?? 0;
                return (
                  <button
                    key={position}
                    type="button"
                    aria-pressed={positionFilter === position}
                    aria-label={`${position === 'ALL' ? 'All' : position}, ${String(filled)} of ${String(total)} filled`}
                    onClick={() => {
                      setPositionFilter(position);
                      setShowAllPlayers(false);
                    }}
                  >
                    <span>{position === 'ALL' ? 'All' : position}</span>
                    <small>{String(filled)}/{String(total)}</small>
                  </button>
                );
              })}
            </div>
            <div className="rec-sort">
              <span id="rec-pool-sort-label" className="rec-muted">Sort</span>
              <Select
                aria-labelledby="rec-pool-sort-label"
                className="h-9 w-[180px] text-xs"
                value={poolSort}
                onValueChange={(value) => { setPoolSort(value as PoolSort); }}
                options={[
                  { value: 'recommendation', label: 'Recommendation' },
                  { value: 'tier', label: 'Tier first' },
                ]}
              />
            </div>
          </div>
          {cards.length > 0 ? (
            <div className="rec-pool-list">
              <CandidateRowHeader />
              {cards.map((recommendation, order) => (
                <AssistantRecommendationRow
                  key={recommendation.playerId}
                  recommendation={recommendation}
                  player={playerById.get(recommendation.playerId)}
                  rank={poolDecision.rankByPlayerId.get(recommendation.playerId) ?? order + 1}
                  order={order}
                  isSelected={selectedRecommendation?.playerId === recommendation.playerId}
                  isBestPick={recommendation.playerId === bestPickId}
                  isQueued={queuedSet.has(recommendation.playerId)}
                  alert={alertsFor(recommendation.playerId)[0]}
                  onSelect={(playerId) => { handleSelectPlayer(playerId); openAnalysis(analysisTab); }}
                  onQueue={togglePlayerQueued}
                />
              ))}
            </div>
          ) : (
            <div role="status" className="rec-empty">
              {deferredSearch
                ? 'No players match your search and position filter.'
                : `No available ${positionFilter === 'ALL' ? '' : `${positionFilter} `}players.`}
            </div>
          )}
          {hiddenPlayerCount > 0 || showAllPlayers ? (
            <div className="rec-pool-more">
              <Button variant="outline" size="sm" aria-expanded={showAllPlayers} onClick={() => { setShowAllPlayers((current) => !current); }}>
                {showAllPlayers
                  ? <><ChevronUp className="size-4" aria-hidden="true" /> Show fewer players</>
                  : <><ChevronDown className="size-4" aria-hidden="true" /> Show {String(hiddenPlayerCount)} more players</>}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      </div>
      )}
    </main>
  );
}
