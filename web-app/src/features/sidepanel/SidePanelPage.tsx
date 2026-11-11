import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { useDraftState, useConnectionState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { DRAFT_DISPLAY, RANKING_LABELS } from '@/lib/demo-mode';
import { type Player } from '@fantasy-draft/shared/league';
import { createSlotSequence, type PositionNeed, type Recommendation } from '@fantasy-draft/shared/draft';
import { type DraftProvider } from '@fantasy-draft/shared/sync';
import * as React from 'react';
import { Check, ChevronLeft, ExternalLink, Lightbulb, Radio, Target } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { DecisionSwap } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { getPositionRecommendations } from '@/features/assistant/assistant-position-rankings';
import { DraftTurnBanner } from '@/features/draft-room/DraftTurnBanner';
import { DraftReadinessBlockedNotice } from '@/features/draft-room/DraftReadinessBlockedNotice';
import { ProviderIdentityBlockedNotice } from '@/features/draft-room/ProviderIdentityBlockedNotice';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { getPreferredRecommendation, getRecommendationPolicyLabel, type DraftDecisionView, getRecommendationExplanation, formatSignedNumber } from '@fantasy-draft/shared/draft';
import { useDraftSync, type DraftSyncViewState } from '@/hooks/useDraftSync';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueryClient } from '@tanstack/react-query';
import { useTeamNeeds } from '@/hooks/useTeamNeeds';
import { receptionScoringLabel } from '@/lib/scoring-label';
import { cn } from '@/lib/utils';
import { getNextPickAvailability } from '@/lib/next-pick-availability';
import { DraftSyncStatusIndicator } from '@/features/draft-room/DraftSyncStatusIndicator';
import { SidePanelSlotControl } from './SidePanelSlotControl';
import { HERO_CARD, PANEL_CARD, PANEL_LABEL, PositionFilters, SidePanelFrame, SidePanelHeader, SidePanelNavigation, SidePanelSkeleton, STATUS_CARD, STATUS_TURN_ROW, StatusCardAction, type PositionFilter, type SidePanelView } from './SidePanelFrame';
import { reconcileComparisonSelection, resolveAssistantComparison } from './comparison-selection';
import { getAvailabilityText, getSurvival, getMissingSurvivalText, getCompactDecisionExplanation, getAnswerHeadline, getNeedSlotSummary, getWaitAnswer } from './sidepanel-insights';
import { getRecommendationVerdict } from '@/features/draft-room/suggestion-reasons';
import { describeRosterFit } from '@/features/assistant/AssistantAnalysisPanel';
import { getTurnStatus } from '@/features/draft-room/turn-status';
import { RecommendationHero } from './SidePanelHero';
import { ComparisonList } from './SidePanelComparisonList';
import { RosterPressure, RosterPanel } from './SidePanelRoster';

type AssistantLens = 'why' | 'compare' | 'wait' | 'roster';

interface SidePanelConnection {
  readonly provider: DraftProvider;
  readonly draftId: string | null;
  readonly draftPosition: number | null;
}

function getProviderLabel(provider: DraftProvider): string {
  if (provider === 'yahoo') return 'Yahoo';
  if (provider === 'sleeper') return 'Sleeper';
  return 'ESPN';
}

function useSidePanelSync(connection: SidePanelConnection) {
  const sync = useDraftSync(connection.provider, connection.draftId, true);

  return sync;
}

function SidePanelStatus({
  connection,
  sync,
  onOpenWorkspace,
}: {
  readonly connection: SidePanelConnection;
  readonly sync: DraftSyncViewState;
  /** A secondary action in the card's own footer, so it never floats above the header. */
  readonly onOpenWorkspace?: (() => void) | undefined;
}): React.ReactElement {
  const config = useDraftState((state) => state.config);
  const currentPick = useDraftView((view) => view.currentPick);
  return (
    <div className={STATUS_CARD}>
      <div className="flex h-14 min-w-0 flex-col justify-center gap-0.5 px-3">
        <span className="truncate font-semibold">{getProviderLabel(connection.provider)} draft</span>
        <DraftSyncStatusIndicator sync={sync} compact className="text-2xs" />
      </div>
      <div className="flex h-14 items-center justify-center border-l border-border/70 px-4 font-mono text-muted-foreground" aria-label="Current pick">
        {createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).label(currentPick)}
      </div>
      <div className={STATUS_TURN_ROW}>
        <DraftTurnBanner variant="compact" className="w-full" />
      </div>
      <StatusCardAction onOpenWorkspace={onOpenWorkspace} />
    </div>
  );
}

function HeadToHead({
  recommendations,
  decision,
  playerById,
  onAskWhy,
}: {
  readonly recommendations: readonly Recommendation[];
  readonly decision: DraftDecisionView;
  readonly playerById: ReadonlyMap<string, Player>;
  /** Receives the player with the edge and the player it was compared against. */
  readonly onAskWhy: (preferred: Recommendation, other: Recommendation) => void;
}): React.ReactElement {
  const [first, second] = recommendations;
  if (!first || !second) {
    return <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Select two players to compare.</div>;
  }

  const firstDiagnostics = first.diagnostics;
  const secondDiagnostics = second.diagnostics;
  const rows = [
    ['Recommendation rank', `#${String(decision.rankByPlayerId.get(first.playerId) ?? '—')}`, `#${String(decision.rankByPlayerId.get(second.playerId) ?? '—')}`],
    ['Pts over a fill-in starter', firstDiagnostics ? formatSignedNumber(firstDiagnostics.valueOverReplacement, 0) : '—', secondDiagnostics ? formatSignedNumber(secondDiagnostics.valueOverReplacement, 0) : '—'],
    ['Position tier', `Tier ${String(firstDiagnostics?.tier ?? '—')}`, `Tier ${String(secondDiagnostics?.tier ?? '—')}`],
    ['At your next pick', getAvailabilityText(first), getAvailabilityText(second)],
    [`Overall ${RANKING_LABELS.short}`, `#${String(firstDiagnostics?.expertRank ?? '—')}`, `#${String(secondDiagnostics?.expertRank ?? '—')}`],
  ] as const;
  const firstPlayer = playerById.get(first.playerId);
  const secondPlayer = playerById.get(second.playerId);
  const preferred = getPreferredRecommendation(decision, [first, second]) ?? first;
  const preferredExplanation = decision.explanationByPlayerId.get(preferred.playerId)
    ?? getRecommendationExplanation(preferred, DRAFT_DISPLAY);

  return (
    <>
      <div key={`${first.playerId}:${second.playerId}`}>
        <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
          <div className="border-b border-border/70 px-4 py-3 text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Head-to-head
          </div>
          <div className="grid grid-cols-[1.15fr_1fr_1fr] border-b border-border/70">
            <div />
            {[{ recommendation: first, player: firstPlayer }, { recommendation: second, player: secondPlayer }].map(({ recommendation, player }) => (
              <div key={recommendation.playerId} className="min-w-0 border-l border-border/70 p-3 text-center">
                <PlayerHeadshot
                  playerId={recommendation.playerId}
                  name={recommendation.playerName}
                  position={recommendation.position}
                  className="mx-auto size-12 rounded-lg"
                />
                <div className="mt-2 truncate text-2xs font-bold">{recommendation.playerName}</div>
                <div className="mt-0.5 text-2xs text-muted-foreground">{recommendation.position}{player?.team ? ` · ${player.team}` : ''}</div>
              </div>
            ))}
          </div>
          {rows.map(([label, firstValue, secondValue]) => (
            <div key={label} className="grid grid-cols-[1.15fr_1fr_1fr] border-b border-border/70 text-2xs last:border-b-0">
              <div className="px-3 py-2.5 text-muted-foreground">{label}</div>
              <div className={cn(
                'border-l border-border/70 px-2 py-2.5 text-center font-mono',
                preferred.playerId === first.playerId && 'font-bold text-success'
              )}>{firstValue}</div>
              <div className={cn(
                'border-l border-border/70 px-2 py-2.5 text-center font-mono',
                preferred.playerId === second.playerId && 'font-bold text-success'
              )}>{secondValue}</div>
            </div>
          ))}
        </section>
        <section className="mt-3 rounded-xl border border-success/30 bg-success/[0.07] p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-success">
            <Target className="size-4" /> Edge: {preferred.playerName}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {preferredExplanation}
          </p>
          <p className="mt-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            {getRecommendationPolicyLabel(decision.selection, DRAFT_DISPLAY)} policy · rank #{String(decision.rankByPlayerId.get(preferred.playerId) ?? '—')}
          </p>
        </section>
      </div>
      <Button className="w-full" onClick={() => { onAskWhy(preferred, preferred.playerId === first.playerId ? second : first); }}>
        <Lightbulb className="size-4" /> Ask why
      </Button>
    </>
  );
}

function AssistantPanel({
  decision,
  focus,
  comparison,
  needs,
}: {
  readonly decision: DraftDecisionView;
  /** A specific player to explain, such as the winner of a head-to-head; defaults to the preferred pick. */
  readonly focus?: Recommendation;
  readonly comparison?: Recommendation;
  readonly needs: readonly PositionNeed[];
}): React.ReactElement {
  const [lens, setLens] = React.useState<AssistantLens>('why');
  const config = useDraftState((state) => state.config);
  const currentPick = useDraftView((view) => view.currentPick);
  const onClock = getTurnStatus({ currentPick, myPickPosition: config.myPickPosition, totalTeams: config.totalTeams, totalRounds: config.totalRounds, draftType: config.draftType }).kind === 'on-clock';
  const recommendation = focus ?? decision.preferred ?? undefined;
  const explainsComparison = focus !== undefined && focus.playerId !== decision.preferred?.playerId;
  if (!recommendation) {
    return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No player is available to analyze.</div>;
  }

  const diagnostics = recommendation.diagnostics;
  const survival = getSurvival(recommendation);
  // The one verdict the cards and the Assistant use, so the side panel never decides on its own thresholds.
  const verdict = getRecommendationVerdict(recommendation);
  const finalPick = getNextPickAvailability(diagnostics).kind === 'no-next-pick';
  const expectedAlternative = recommendation.decisionFactors?.draftTiming.expectedAlternative
    ?? diagnostics?.expectedNextPickAlternative;
  const need = needs.find((item) => item.position === recommendation.position);
  const detailedExplanation = decision.explanationByPlayerId.get(recommendation.playerId)
    ?? getRecommendationExplanation(recommendation, DRAFT_DISPLAY);
  const explanation = getCompactDecisionExplanation(recommendation) ?? detailedExplanation;
  const reasons = [
    // The raw reason's later parts are model terms; its first part is the plain label the decision bar also uses.
    diagnostics ? `${formatSignedNumber(diagnostics.valueOverReplacement, 0)} pts over a fill-in starter` : recommendation.reason.split(' · ')[0] ?? recommendation.reason,
    diagnostics?.isLastInTier
      ? `Last remaining player in ${recommendation.position} Tier ${String(diagnostics.tier)}`
      : `${String(diagnostics?.tierRemaining ?? 'Several')} players remain in Tier ${String(diagnostics?.tier ?? '—')}`,
    verdict ? `${verdict.label}: ${verdict.reason}` : getMissingSurvivalText(recommendation, 'Availability is still calculating'),
  ];

  return (
    <>
      <DecisionSwap motionKey={recommendation.playerId}>
        <section className={HERO_CARD}>
          <div className="text-2xs font-bold uppercase tracking-[0.12em] text-success">
            Assistant answer
          </div>
          <h2 className="mt-2 text-xl font-bold leading-tight">
            {getAnswerHeadline({ name: recommendation.playerName, verdict, onClock, explainsComparison })}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {explanation}
          </p>
        </section>
      </DecisionSwap>
      <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-border/80 bg-card">
        {([
          ['why', 'Why'],
          ['compare', 'Compare'],
          ['wait', 'Can I wait?'],
          ['roster', 'Roster need'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={lens === id}
            onClick={() => { setLens(id); }}
            className={cn(
              'min-h-12 border-r border-border/70 px-1 text-2xs font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              lens === id ? 'bg-success/10 text-success' : 'text-muted-foreground hover:bg-muted/40'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <section className={HERO_CARD}>
        <div key={`${lens}:${recommendation.playerId}:${comparison?.playerId ?? 'none'}`}>
          {lens === 'why' ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-success">Why this player?</h3>
              <div className="mt-3 space-y-3">
                {reasons.map((reason) => (
                  <div key={reason} className="flex gap-2 border-b border-border/60 pb-3 text-sm last:border-b-0 last:pb-0">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : lens === 'compare' ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-success">Quick comparison</h3>
              {comparison ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-border/70 text-xs">
                  <div className="grid grid-cols-3 bg-muted/30 px-3 py-2 font-bold"><span>Signal</span><span>{recommendation.playerName}</span><span>{comparison.playerName}</span></div>
                  <div className="grid grid-cols-3 border-t px-3 py-2"><span className="text-muted-foreground">Over fill-in</span><span className="font-mono text-success">{diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'}</span><span className="font-mono">{comparison.diagnostics ? formatSignedNumber(comparison.diagnostics.valueOverReplacement, 0) : '—'}</span></div>
                  <div className="grid grid-cols-3 border-t px-3 py-2"><span className="text-muted-foreground">Tier</span><span className="font-mono">{String(diagnostics?.tier ?? '—')}</span><span className="font-mono">{String(comparison.diagnostics?.tier ?? '—')}</span></div>
                </div>
              ) : <p className="mt-3 text-sm text-muted-foreground">Select a second player in Compare.</p>}
            </div>
          ) : lens === 'wait' ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-success">Can I wait?</h3>
              <p className="mt-3 text-lg font-bold">{survival === null ? getMissingSurvivalText(recommendation, 'Still calculating') : `${String(survival)}% at pick ${diagnostics?.nextPickLabel ?? 'next'}`}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {getWaitAnswer(verdict, finalPick)}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {expectedAlternative
                  ? `${expectedAlternative.playerName} is the expected ${recommendation.position} fallback at ${formatSignedNumber(expectedAlternative.expectedValue, 0)} expected pts over a fill-in starter.`
                  : `No same-position fallback is projected for that selection.`}
              </p>
              {diagnostics?.survivalModelSource === 'league-history' ? (
                <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
                  Timing evidence: 70% Primary League history, 25% current consensus, 5% Sleeper search rank.
                </p>
              ) : null}
            </div>
          ) : (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-success">Roster need</h3>
              <p className="mt-3 text-lg font-bold">{need ? `${describeRosterFit(need)}.` : `No roster data for ${recommendation.position} yet.`}</p>
              <p className="mt-2 text-sm text-muted-foreground">{need ? `${getNeedSlotSummary(need)}.` : 'Roster context is unavailable.'}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** Keeps the draft connection alive while the panel content shows an error fallback. */
export function SidePanelPage({ onOpenWorkspace }: { readonly onOpenWorkspace?: () => void } = {}): React.ReactElement {
  const selected = useConnectionState(state => state.connection);
  const connection: SidePanelConnection = selected ?? { provider: 'espn', draftId: null, draftPosition: null };
  const sync = useSidePanelSync(connection);
  return (
    <RouteErrorBoundary>
      <SidePanelSlotControl />
      <SidePanelContent connection={connection} sync={sync} onOpenWorkspace={STORAGE_ACTIVATION_ENABLED ? onOpenWorkspace : undefined} />
    </RouteErrorBoundary>
  );
}

function SidePanelContent({
  connection,
  sync,
  onOpenWorkspace,
}: {
  readonly connection: SidePanelConnection;
  readonly sync: ReturnType<typeof useSidePanelSync>;
  readonly onOpenWorkspace?: (() => void) | undefined;
}): React.ReactElement {
  const [view, setView] = React.useState<SidePanelView>('draft');
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [selectedPlayerIds, setSelectedPlayerIds] = React.useState<readonly string[] | null>(null);
  // Set by Compare's "Ask why" so the Assistant explains the compared players, not the global top pick.
  const [assistantFocus, setAssistantFocus] = React.useState<{ readonly playerId: string; readonly playerName: string; readonly comparisonId: string; readonly comparisonName: string } | null>(null);
  // Why the Assistant stopped explaining the focused player, so the fallback to the top pick is never silent.
  const [lostFocusNotice, setLostFocusNotice] = React.useState<string | null>(null);
  const draftedPlayerIds = useDraftView((view) => view.draftedPlayerIds);
  const decision = useDraftDecision();
  const { players, isLoading, isError } = usePlayerDataQuery();
  const { needs } = useTeamNeeds();
  const leagueSettings = useDraftState((state) => state.leagueSettings);
  const totalTeams = useDraftState((state) => state.config.totalTeams);
  const draftType = useDraftState((state) => state.config.draftType);
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const activeDecision = positionFilter === 'ALL'
    ? decision.overall
    : decision.byPosition[positionFilter];
  const recommendations = React.useMemo(() => positionFilter === 'ALL'
    ? activeDecision.recommendations
    : getPositionRecommendations(activeDecision), [activeDecision, positionFilter]);
  const topRecommendation = activeDecision.preferred ?? undefined;
  const showReadinessBlock =
    view !== 'roster' &&
    decision.recommendationsBlocked &&
    !decision.recommendationsBlockedByProviderIdentity &&
    decision.readiness !== null;
  const showProviderIdentityBlock =
    view !== 'roster' && decision.recommendationsBlockedByProviderIdentity;
  const showRecommendationBlock =
    showReadinessBlock || showProviderIdentityBlock;

  React.useEffect(() => {
    const recommendationIds = recommendations.map((recommendation) => recommendation.playerId);
    setSelectedPlayerIds((current) => reconcileComparisonSelection(current, recommendationIds));
  }, [recommendations]);

  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [view]);

  const selectedRecommendations = (selectedPlayerIds ?? []).flatMap((playerId) => {
    const recommendation = recommendations.find((item) => item.playerId === playerId);
    return recommendation ? [recommendation] : [];
  });

  const focusedRecommendation = assistantFocus
    ? recommendations.find((recommendation) => recommendation.playerId === assistantFocus.playerId)
    : undefined;
  const assistantComparison = resolveAssistantComparison({
    subject: focusedRecommendation ?? topRecommendation,
    requested: focusedRecommendation && assistantFocus ? { playerId: assistantFocus.comparisonId, playerName: assistantFocus.comparisonName } : null,
    selected: selectedRecommendations,
    recommendations,
    isDrafted: (playerId) => draftedPlayerIds.has(playerId),
  });
  React.useEffect(() => {
    // Recommendations are empty while loading; only a loaded list that lacks the player means it left.
    if (!assistantFocus || focusedRecommendation || recommendations.length === 0) return;
    setLostFocusNotice(draftedPlayerIds.has(assistantFocus.playerId)
      ? `${assistantFocus.playerName} was drafted. Showing the current top pick instead.`
      : `${assistantFocus.playerName} is no longer in this list. Showing the current top pick instead.`);
    setAssistantFocus(null);
  }, [assistantFocus, draftedPlayerIds, focusedRecommendation, recommendations.length]);
  const showView = React.useCallback((next: SidePanelView): void => {
    setAssistantFocus(null);
    setLostFocusNotice(null);
    setView(next);
  }, []);

  const toggleSelectedPlayer = React.useCallback((playerId: string): void => {
    setSelectedPlayerIds((selection) => {
      const current = selection ?? [];
      if (current.includes(playerId)) return current.filter((id) => id !== playerId);
      if (current.length >= 2) return [current[1] ?? playerId, playerId];
      return [...current, playerId];
    });
  }, []);

  const openFullDraftRoom = React.useCallback((): void => {
    const params = new URLSearchParams(window.location.search);
    const target = `/draft${params.size > 0 ? `?${params.toString()}` : ''}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  }, []);

  if (isLoading || decision.isLoading) {
    return <SidePanelSkeleton onOpenWorkspace={onOpenWorkspace} />;
  }

  if (isError) return <SidePanelDataError status={<SidePanelStatus connection={connection} sync={sync} onOpenWorkspace={onOpenWorkspace} />} />;

  return (
    <SidePanelFrame
      header={(
        <SidePanelHeader
          leading={view === 'draft' ? undefined : (
            <button
              type="button"
              aria-label="Return to Draft"
              onClick={() => { showView('draft'); }}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          title={view === 'draft' ? 'Fantasy Draft' : view === 'compare' ? 'Compare players' : view === 'assistant' ? 'Assistant' : 'My roster'}
          subtitle={view === 'draft' && leagueSettings.source === 'espn' ? (
            <div className="mt-0.5 truncate text-2xs text-muted-foreground">
              {String(leagueSettings.totalTeams)}-team {receptionScoringLabel(leagueSettings.scoringRules.receiving.reception)} · {leagueSettings.keepersEnabled ? 'keepers' : 'no keepers'}
            </div>
          ) : view !== 'draft' ? (
            <div className="mt-0.5 flex items-center gap-1 text-2xs text-success">
              <Radio className="size-2.5" /> Live decision state
            </div>
          ) : null}
        />
      )}
      navigation={<SidePanelNavigation view={view} onChange={showView} />}
    >
      <SidePanelStatus connection={connection} sync={sync} onOpenWorkspace={onOpenWorkspace} />
      {(view === 'draft' || view === 'compare') && !showRecommendationBlock ? (
        <PositionFilters
          value={positionFilter}
          onChange={(position) => {
            setPositionFilter(position);
            setView(view === 'compare' ? 'compare' : 'draft');
          }}
        />
      ) : null}

      <div
        key={showProviderIdentityBlock
          ? 'provider-identity-blocked'
          : showReadinessBlock
            ? 'readiness-blocked'
            : view}
        className="space-y-3"
      >
        {showProviderIdentityBlock ? (
          <ProviderIdentityBlockedNotice
            unresolvedPicks={decision.unresolvedProviderPicks}
            totalTeams={totalTeams}
            draftType={draftType}
          />
        ) : showReadinessBlock ? (
          <DraftReadinessBlockedNotice readiness={decision.readiness} />
        ) : view === 'draft' ? (
          <>
            <RecommendationHero
              decision={activeDecision}
              player={topRecommendation ? playerById.get(topRecommendation.playerId) : undefined}
              onCompare={() => { showView('compare'); }}
              onAskWhy={() => { showView('assistant'); }}
            />
            <ComparisonList
              decision={activeDecision}
              playerById={playerById}
              selectedIds={new Set(selectedPlayerIds)}
              onToggle={toggleSelectedPlayer}
              onCompare={() => { showView('compare'); }}
            />
            <RosterPressure needs={needs} />
            <Button variant="outline" className="w-full" onClick={openFullDraftRoom}>
              Open full draft room <ExternalLink className="size-4" />
            </Button>
          </>
        ) : view === 'compare' ? (
          <>
            <HeadToHead
              recommendations={selectedRecommendations}
              decision={activeDecision}
              playerById={playerById}
              onAskWhy={(preferred, other) => {
                setLostFocusNotice(null);
                setAssistantFocus({ playerId: preferred.playerId, playerName: preferred.playerName, comparisonId: other.playerId, comparisonName: other.playerName });
                setView('assistant');
              }}
            />
            <div className={PANEL_CARD}>
              <div className={PANEL_LABEL}>
                Top {positionFilter === 'ALL' ? 'available' : positionFilter} options
              </div>
              <ComparisonList
                decision={activeDecision}
                playerById={playerById}
                selectedIds={new Set(selectedPlayerIds)}
                onToggle={toggleSelectedPlayer}
              />
            </div>
            <Button variant="outline" className="w-full" onClick={() => { showView('draft'); }}>
              <ChevronLeft className="size-4" /> Return to Draft
            </Button>
          </>
        ) : view === 'assistant' ? (
          <>
            {lostFocusNotice ?? assistantComparison.notice ? (
              <p role="status" className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs font-semibold text-warning">{lostFocusNotice ?? assistantComparison.notice}</p>
            ) : null}
            <AssistantPanel
              decision={activeDecision}
              focus={focusedRecommendation}
              comparison={assistantComparison.comparison}
              needs={needs}
            />
          </>
        ) : (
          <RosterPanel playerById={playerById} needs={needs} />
        )}
      </div>
    </SidePanelFrame>
  );
}

/**
 * Player data failed to load: the panel keeps its header and status card (with Open local workspace in its footer),
 * and the error and Retry take the recommendation's place. Retry refetches the failed requests without a reload.
 */
function SidePanelDataError({ status }: { readonly status: React.ReactNode }): React.ReactElement {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = React.useState(false);
  return (
    <SidePanelFrame header={<SidePanelHeader title="Fantasy Draft" />} navigation={<SidePanelNavigation view="draft" />}>
      {status}
      <section className={PANEL_CARD} data-panel-error="">
        <p role="alert" className="text-sm font-semibold text-danger">Unable to load player data.</p>
        <p className="mt-1 text-xs text-muted-foreground">Recommendations return once the data loads.</p>
        <Button size="sm" variant="outline" className="mt-3" disabled={retrying} aria-busy={retrying || undefined}
          onClick={() => {
            setRetrying(true);
            void queryClient.refetchQueries({ type: 'active' }).finally(() => { setRetrying(false); });
          }}>
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      </section>
    </SidePanelFrame>
  );
}
