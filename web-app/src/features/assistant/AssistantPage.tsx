import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import {
  DecisionSwap,
  MotionIdentitySwap,
  MotionMetricSwap,
  StatePulseDot,
} from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { AssistantLens } from '@/features/assistant/assistant-navigation';
import { getPositionRecommendations } from '@/features/assistant/assistant-position-rankings';
import { DraftReadinessBlockedNotice } from '@/features/draft-room/DraftReadinessBlockedNotice';
import { ProviderIdentityBlockedNotice } from '@/features/draft-room/ProviderIdentityBlockedNotice';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { getRecommendationPolicyLabel } from '@/features/recommendations/draft-decision';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useTeamNeeds } from '@/hooks/useTeamNeeds';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { cn, formatSignedNumber } from '@/lib/utils';
import { useDraftStore } from '@/stores/draftStore';
import { POSITIONS, type Position, type Recommendation } from '@fantasy-draft/shared';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  GitCompareArrows,
  ListPlus,
  Search,
  ShieldQuestion,
  Target,
} from 'lucide-react';
import * as React from 'react';

import { RosterAnswer, WaitAnswer, WhyAnswer } from './AssistantAnswers';
import { AssistantComparisonSnapshot, CompareAnswer } from './AssistantComparison';
import { RecommendationCard } from './AssistantRecommendationCard';
import { AssistantRecommendationRow } from './AssistantRecommendationRow';
import {
  getAssistantPlayerCopy,
  getNeedSlotSummary,
  getNeedTone,
  getSignalSurface,
  getSignalValueColor,
  PoolSort,
  sortRecommendationsForPool,
  survivalPercent,
} from './assistant-analysis';
import { useCollapsedPlayerCount, useUsesDesktopPlayerPool } from './useAssistantLayout';

export type PositionFilter = 'ALL' | Position;

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', ...POSITIONS];
const lenses: readonly {
  readonly id: AssistantLens;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof ShieldQuestion;
}[] = [
  {
    id: 'why',
    label: 'Why this player?',
    description: 'Explain the selected player',
    icon: ShieldQuestion,
  },
  {
    id: 'compare',
    label: 'Compare options',
    description: 'Selected player versus the best alternative',
    icon: GitCompareArrows,
  },
  {
    id: 'wait',
    label: 'Can I wait?',
    description: 'See if the selected player will return',
    icon: Clock3,
  },
  {
    id: 'roster',
    label: 'What does my roster need?',
    description: 'Balance need and scarcity',
    icon: Target,
  },
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
  const [lens, setLens] = React.useState<AssistantLens>(initialLens);
  const [showAllPlayers, setShowAllPlayers] = React.useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = React.useState<string | null>(
    initialSelectedPlayerId
  );
  const [comparisonPlayerId, setComparisonPlayerId] = React.useState<string | null>(null);
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const deferredSearch = React.useDeferredValue(searchQuery.trim().toLowerCase());
  const [poolSort, setPoolSort] = React.useState<PoolSort>('recommendation');
  const analysisPanelRef = React.useRef<HTMLElement>(null);
  const collapsedPlayerCount = useCollapsedPlayerCount();
  const usesDesktopPlayerPool = useUsesDesktopPlayerPool();
  const decision = useDraftDecision();
  const { players } = usePlayerDataQuery();
  const { needs } = useTeamNeeds();
  const config = useDraftStore((state) => state.config);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const queuedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const { togglePlayerQueued } = useQueueActions(players);
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const activeDecision = positionFilter === 'ALL'
    ? decision.overall
    : decision.byPosition[positionFilter];
  const topPick = activeDecision.preferred;
  const filteredRecommendations = positionFilter === 'ALL'
    ? activeDecision.recommendations
    : getPositionRecommendations(activeDecision);
  const poolRecommendations = React.useMemo(
    () => sortRecommendationsForPool(filteredRecommendations, poolSort).filter((recommendation) =>
      !deferredSearch || `${recommendation.playerName} ${playerById.get(recommendation.playerId)?.team ?? ''}`.toLowerCase().includes(deferredSearch)
    ),
    [filteredRecommendations, poolSort, deferredSearch, playerById]
  );
  const modelRankByPlayerId = activeDecision.rankByPlayerId;
  const selectedRecommendation = filteredRecommendations.find(
    (recommendation) => recommendation.playerId === selectedPlayerId
  ) ?? filteredRecommendations[0] ?? topPick;
  const availableComparisons = selectedRecommendation
    ? filteredRecommendations.filter(
        (recommendation) => recommendation.playerId !== selectedRecommendation.playerId
      )
    : [];
  const comparisonRecommendation = availableComparisons.find(
    (recommendation) => recommendation.playerId === comparisonPlayerId
  ) ?? availableComparisons[0];
  const comparisonRecommendations: readonly Recommendation[] = selectedRecommendation
    ? comparisonRecommendation
      ? [selectedRecommendation, comparisonRecommendation]
      : [selectedRecommendation]
    : [];
  const cards = showAllPlayers
    ? poolRecommendations
    : poolRecommendations.slice(0, collapsedPlayerCount);
  const hiddenPlayerCount = poolRecommendations.length - cards.length;
  const selectedPositionNeed = positionFilter === 'ALL'
    ? undefined
    : needs.find((need) => need.position === positionFilter);
  const selectedPositionIndex = selectedRecommendation
    ? filteredRecommendations.findIndex(
        (recommendation) => recommendation.playerId === selectedRecommendation.playerId
      )
    : -1;
  const selectedPositionRank = positionFilter !== 'ALL' && selectedPositionIndex >= 0
    ? selectedPositionIndex + 1
    : undefined;
  const handleSelectPlayer = React.useCallback((playerId: string): void => {
    setSelectedPlayerId(playerId);
    setComparisonPlayerId(null);
  }, []);
  const handleCompareFromCard = React.useCallback((playerId: string): void => {
    setLens('compare');
    setComparisonPlayerId(playerId);
    window.requestAnimationFrame(() => {
      analysisPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  if (decision.recommendationsBlockedByProviderIdentity) {
    return (
      <main className="assistant-workspace w-full px-4 py-4">
        <Button variant="outline" size="sm" onClick={onReturnToDraft}>
          <ArrowLeft className="size-4" /> Return to Draft Workspace
        </Button>
        <ProviderIdentityBlockedNotice
          unresolvedPicks={decision.unresolvedProviderPicks}
          totalTeams={config.totalTeams}
          className="mx-auto mt-4 max-w-3xl"
        />
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
      <main className="assistant-workspace w-full px-4 py-4">
        <Button variant="outline" size="sm" onClick={onReturnToDraft}>
          <ArrowLeft className="size-4" /> Return to Draft Workspace
        </Button>
        <DraftReadinessBlockedNotice
          readiness={decision.readiness}
          className="mx-auto mt-4 max-w-3xl"
        />
      </main>
    );
  }

  const selectedPlayer = selectedRecommendation
    ? playerById.get(selectedRecommendation.playerId)
    : undefined;
  const selectedDiagnostics = selectedRecommendation?.diagnostics;
  const selectedSurvival = selectedRecommendation
    ? survivalPercent(selectedRecommendation)
    : null;
  const selectedPlayerCopy = selectedRecommendation
    ? getAssistantPlayerCopy(selectedRecommendation, topPick)
    : null;

  return (
    <main className="assistant-workspace w-full px-4 py-4">
      <section className="mb-4 flex min-h-11 flex-wrap items-center justify-between gap-3 border-y border-border/65 bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">
            Pick {formatRoundPick(decision.currentPick, config.totalTeams)} · #{String(decision.currentPick)}
          </span>
          <span className="text-xs text-muted-foreground">{String(config.totalTeams)} teams · {String(config.totalRounds)} rounds · Snake</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <StatePulseDot
            motionKey={`${String(decision.currentPick)}:${topPick?.playerId ?? 'none'}:${sessionMode}`}
            className="size-2 text-emerald-500"
          />
          Same live decision state · {getRecommendationPolicyLabel(activeDecision.selection)} · {sessionMode === 'setup' ? 'preview' : sessionMode}
        </div>
      </section>

      {selectedRecommendation ? (
        <section className="assistant-recommendation mb-3 overflow-hidden rounded-xl border border-border/75 bg-card shadow-sm">
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center xl:p-5 2xl:gap-6 2xl:p-6">
            <MotionIdentitySwap motionKey={selectedRecommendation.playerId} className="min-w-0">
              <div className="flex min-w-0 items-center gap-4 2xl:gap-5">
                <PlayerHeadshot
                  playerId={selectedRecommendation.playerId}
                  name={selectedRecommendation.playerName}
                  position={selectedRecommendation.position}
                  className="size-24 rounded-xl border border-border/70 2xl:size-28"
                />
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-bold leading-tight xl:text-2xl 2xl:text-3xl">
                    {selectedPlayerCopy?.analysisHeading}
                  </h1>
                  <p className="mt-1 text-sm font-semibold text-foreground xl:text-base 2xl:mt-2 2xl:text-lg">
                    {selectedPlayerCopy?.recommendationStatus}
                  </p>
                  <MotionMetricSwap
                    motionKey={`${String(selectedSurvival)}:${selectedRecommendation.diagnostics?.nextPickLabel ?? 'none'}`}
                    className="mt-1 text-sm text-muted-foreground xl:text-base 2xl:text-lg"
                  >
                    {selectedSurvival === null
                      ? 'Availability is still being calculated.'
                      : `Draft now or wait. Return Probability at pick ${selectedRecommendation.diagnostics?.nextPickLabel ?? 'your next selection'} is ${String(selectedSurvival)}%.`}
                  </MotionMetricSwap>
                  <div className="mt-2 text-sm text-muted-foreground xl:text-base 2xl:text-lg">
                    <span className="font-mono font-bold text-sky-600 dark:text-sky-300">{selectedRecommendation.position}</span>
                    {selectedPlayer?.team ? <span> · {selectedPlayer.team}</span> : null}
                  </div>
                </div>
              </div>
            </MotionIdentitySwap>
            <div className="grid gap-2 2xl:gap-3">
              <Button className="2xl:h-11 2xl:text-base" onClick={onReturnToDraft}>Return to draft <ArrowLeft className="size-4 rotate-180" /></Button>
              <Button
                variant={queuedSet.has(selectedRecommendation.playerId) ? 'secondary' : 'outline'}
                className="2xl:h-11 2xl:text-base"
                onClick={() => { togglePlayerQueued(selectedRecommendation.playerId); }}
              >
                {queuedSet.has(selectedRecommendation.playerId) ? <Check className="size-4" /> : <ListPlus className="size-4" />}
                {queuedSet.has(selectedRecommendation.playerId) ? 'In draft queue' : 'Add to queue'}
              </Button>
            </div>
          </div>
          <dl className="grid border-t border-border/70 sm:grid-cols-3">
            <div className="border-b border-border/70 px-4 py-3 text-center sm:border-b-0 sm:border-r 2xl:py-4">
              <dt>
                <MotionMetricSwap
                  motionKey={selectedDiagnostics?.valueOverReplacement ?? 'none'}
                  className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300 2xl:text-2xl"
                >
                  {selectedDiagnostics ? formatSignedNumber(selectedDiagnostics.valueOverReplacement, 0) : '—'}
                </MotionMetricSwap>
              </dt>
              <dd className="mt-1 text-[11px] text-muted-foreground 2xl:text-sm">above replacement</dd>
            </div>
            <div className="border-b border-border/70 px-4 py-3 text-center sm:border-b-0 sm:border-r 2xl:py-4">
              <dt>
                <MotionMetricSwap
                  motionKey={`${String(selectedDiagnostics?.tier)}:${String(selectedDiagnostics?.isLastInTier)}`}
                  className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300 2xl:text-2xl"
                >
                  Tier {String(selectedDiagnostics?.tier ?? '—')}{selectedDiagnostics?.isLastInTier ? ' · last in tier' : ''}
                </MotionMetricSwap>
              </dt>
              <dd className="mt-1 text-[11px] text-muted-foreground 2xl:text-sm">position tier</dd>
            </div>
            <div className="px-4 py-3 text-center 2xl:py-4">
              <dt>
                <MotionMetricSwap
                  motionKey={selectedSurvival ?? 'none'}
                  className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300 2xl:text-2xl"
                >
                  {selectedSurvival === null ? '—' : `${String(selectedSurvival)}%`}
                </MotionMetricSwap>
              </dt>
              <dd className="mt-1 text-[11px] text-muted-foreground 2xl:text-sm">at your next pick</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="assistant-decision-layout">
        <div className="assistant-answer-panel">
        <aside className="assistant-question-tabs" aria-label="Assistant questions">
          <div className="px-3 pb-2 pt-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground xl:text-sm 2xl:px-4 2xl:pb-3 2xl:text-base">
            Decision lenses
          </div>
          <div className="space-y-1">
            {lenses.map((item) => {
              const Icon = item.icon;
              const active = lens === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setLens(item.id); }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:py-4 2xl:gap-4 2xl:px-4 2xl:py-5',
                    active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'
                  )}
                >
                  <Icon className="mt-0.5 size-5 shrink-0 xl:size-6 2xl:size-7" />
                  <span>
                    <span className="block text-base font-semibold xl:text-lg 2xl:text-xl">{item.label}</span>
                    <span className={cn(
                      'mt-1 block text-sm leading-snug xl:text-base 2xl:mt-2 2xl:text-lg',
                      active ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    )}>
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section
          ref={analysisPanelRef}
          className="assistant-answer min-w-0 scroll-mt-20"
          aria-live="polite"
        >
          <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300 xl:mb-7 xl:text-base 2xl:mb-8 2xl:gap-3 2xl:text-lg">
            <ShieldQuestion className="size-5 xl:size-6 2xl:size-7" /> Assistant analysis
            {selectedRecommendation ? (
              <Badge variant="outline" className="normal-case tracking-normal text-foreground xl:px-3 xl:text-sm 2xl:text-base">
                {lens === 'compare' && comparisonRecommendation
                  ? `${selectedRecommendation.playerName} vs ${comparisonRecommendation.playerName}`
                  : selectedRecommendation.playerName}
              </Badge>
            ) : null}
          </div>
          <DecisionSwap motionKey={`${lens}:${selectedRecommendation?.playerId ?? 'none'}`}>
            {decision.isLoading ? (
              <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">Updating the decision snapshot…</p>
            ) : !selectedRecommendation ? (
              <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">No available recommendation for this draft state.</p>
            ) : lens === 'why' ? (
              <WhyAnswer
                recommendation={selectedRecommendation}
                isTopPick={selectedRecommendation.playerId === topPick?.playerId}
                positionRank={selectedPositionRank}
                preferredExplanation={activeDecision.explanationByPlayerId.get(selectedRecommendation.playerId)}
              />
            ) : lens === 'compare' ? (
              <CompareAnswer
                recommendations={comparisonRecommendations}
                availableComparisons={availableComparisons}
                decision={activeDecision}
                onComparisonPlayerChange={setComparisonPlayerId}
              />
            ) : lens === 'wait' ? (
              <WaitAnswer recommendation={selectedRecommendation} />
            ) : (
              <RosterAnswer needs={needs} recommendation={selectedRecommendation} />
            )}
          </DecisionSwap>
          <p className="mt-5 max-w-5xl border-t pt-3 text-[11px] leading-relaxed text-muted-foreground xl:mt-7 xl:pt-5 xl:text-base 2xl:mt-8 2xl:text-lg">
            This explanation is derived from the same rankings, roster needs, tiers, and survival estimates shown in Suggestions.
          </p>
        </section>

        </div>
        <AssistantComparisonSnapshot
          recommendations={comparisonRecommendations}
          playerById={playerById}
          decision={activeDecision}
        />
      </section>

      {activeDecision.recommendations.length > 0 ? (
        <section className="assistant-player-pool mt-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-bold">
                {positionFilter === 'ALL' ? 'Recommended player pool' : `Best available ${positionFilter}s`}
              </h2>
              <p className="text-xs text-muted-foreground">
                {positionFilter === 'ALL'
                  ? 'Ranked for this pick using value, roster fit, tiers, and availability.'
                  : `Ranked within ${positionFilter} by the same league-aware policy. Select a player to update the analysis.`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onReturnToDraft}>
              Return to board
            </Button>
          </div>
          <div className="player-pool-toolbar">
            <label className="player-search"><Search className="size-4"/><span className="sr-only">Search recommended players</span><input value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); }} placeholder="Search players or teams" /></label>
            <div className="player-position-filters flex gap-1 overflow-x-auto" role="group" aria-label="Filter recommendations by position">
              {POSITION_FILTERS.map((position) => {
                const active = positionFilter === position;
                const positionNeed = position === 'ALL'
                  ? undefined
                  : needs.find((need) => need.position === position);
                const hasUrgentNeed = positionNeed?.priority === 'critical' || positionNeed?.priority === 'high';

                return (
                  <button
                    key={position}
                    type="button"
                    aria-pressed={active}
                    aria-label={position === 'ALL'
                      ? 'Show all recommended players'
                      : `Show ${position} rankings${positionNeed ? `, ${positionNeed.priority} roster need` : ''}`}
                    onClick={() => {
                      setPositionFilter(position);
                      setSelectedPlayerId(null);
                      setComparisonPlayerId(null);
                      setShowAllPlayers(false);
                    }}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    {position}
                    {position !== 'ALL' && hasUrgentNeed ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-1.5 rounded-full',
                          positionNeed.priority === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                        )}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 px-1">
              <span id="player-pool-sort-label" className="text-xs font-semibold text-muted-foreground">Sort</span>
              <Select
                aria-labelledby="player-pool-sort-label"
                className="h-8 w-[190px] text-xs"
                value={poolSort}
                onValueChange={(value) => { setPoolSort(value as PoolSort); }}
                options={[
                  { value: 'recommendation', label: 'Best recommendation' },
                  { value: 'tier', label: 'Tier first' },
                ]}
              />
            </div>
          </div>
          {selectedPositionNeed ? (
            <div className={cn(
              'mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-x-0 border-y px-3 py-2 text-xs',
              getSignalSurface(getNeedTone(selectedPositionNeed))
            )}>
              <Target className={cn('size-4', getSignalValueColor(getNeedTone(selectedPositionNeed)))} />
              <strong className={getSignalValueColor(getNeedTone(selectedPositionNeed))}>
                {selectedPositionNeed.position} is a {selectedPositionNeed.priority} roster need
              </strong>
              <span className="text-muted-foreground">
                {getNeedSlotSummary(selectedPositionNeed)}
              </span>
            </div>
          ) : null}
          {cards.length > 0 ? (
            usesDesktopPlayerPool ? (
              <div className="assistant-scouting-list">
                {cards.map((recommendation, order) => (
                  <AssistantRecommendationRow
                    key={recommendation.playerId}
                    recommendation={recommendation}
                    player={playerById.get(recommendation.playerId)}
                    rank={modelRankByPlayerId.get(recommendation.playerId) ?? 0}
                    order={order}
                    isSelected={selectedRecommendation?.playerId === recommendation.playerId}
                    isQueued={queuedSet.has(recommendation.playerId)}
                    onSelect={handleSelectPlayer}
                    onQueue={togglePlayerQueued}
                  />
                ))}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {cards.map((recommendation) => (
                  <RecommendationCard
                    key={recommendation.playerId}
                    recommendation={recommendation}
                    player={playerById.get(recommendation.playerId)}
                    rank={modelRankByPlayerId.get(recommendation.playerId) ?? 0}
                    rankScope={positionFilter === 'ALL' ? undefined : positionFilter}
                    isSelected={selectedRecommendation?.playerId === recommendation.playerId}
                    isComparisonTarget={lens === 'compare' && comparisonRecommendation?.playerId === recommendation.playerId}
                    isQueued={queuedSet.has(recommendation.playerId)}
                    need={needs.find((need) => need.position === recommendation.position)}
                    compareWithPlayerName={lens === 'compare' ? selectedRecommendation?.playerName : undefined}
                    onSelect={handleSelectPlayer}
                    onCompare={lens === 'compare' ? handleCompareFromCard : undefined}
                    onQueue={togglePlayerQueued}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              {deferredSearch
                ? 'No players match your search and position filter.'
                : `No available ${positionFilter === 'ALL' ? '' : `${positionFilter} `}players.`}
            </div>
          )}
          {poolRecommendations.length > collapsedPlayerCount ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                aria-expanded={showAllPlayers}
                onClick={() => { setShowAllPlayers((current) => !current); }}
              >
                {showAllPlayers ? (
                  <><ChevronUp className="size-4" /> Show fewer players</>
                ) : (
                  <><ChevronDown className="size-4" /> Show {String(hiddenPlayerCount)} more players</>
                )}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
