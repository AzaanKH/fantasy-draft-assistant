import * as React from 'react';
import { ArrowRight, Clock3, Database, GitCompareArrows, Lightbulb } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { MotionIdentitySwap, MotionMetricSwap } from '@/components/motion';
import { RecommendationPanelSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { getRecommendationPolicyLabel } from '@/features/recommendations/draft-decision';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import type { DraftSyncViewState } from '@/hooks/useDraftSync';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { formatSignedNumber } from '@/lib/utils';
import { useDraftStore } from '@/stores/draftStore';
import { DecisionLensSwitcher } from './DecisionLensSwitcher';
import { DraftReadinessBlockedNotice } from './DraftReadinessBlockedNotice';
import { DraftSyncStatusIndicator } from './DraftSyncStatusIndicator';
import { ProviderIdentityBlockedNotice } from './ProviderIdentityBlockedNotice';

function survivalPercent(value: number | undefined): string {
  return value === undefined ? '—' : `${String(Math.round(value * 100))}%`;
}

export function DraftRecommendationRail({
  onOpenAssistant,
  syncState,
}: {
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
  readonly syncState: DraftSyncViewState | null;
}): React.ReactElement {
  const {
    output,
    overall,
    setSelectedLens,
    isLoading,
    readiness,
    recommendationsBlocked,
    recommendationsBlockedByProviderIdentity,
    unresolvedProviderPicks,
  } = useDraftDecision();
  const topPick = overall.preferred;
  const draftNow = overall.recommendations;
  const { players, dataInfo } = usePlayerDataQuery();
  const { canDraft, draftPlayer } = useDraftPlayerAction();
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );

  if (recommendationsBlockedByProviderIdentity) {
    return (
      <ProviderIdentityBlockedNotice
        unresolvedPicks={unresolvedProviderPicks}
        totalTeams={totalTeams}
      />
    );
  }

  if (isLoading) {
    return <RecommendationPanelSkeleton />;
  }

  if (recommendationsBlocked && readiness) {
    return <DraftReadinessBlockedNotice readiness={readiness} />;
  }

  if (!topPick) {
    return (
      <aside className="overflow-hidden rounded-xl border border-border/75 bg-card shadow-sm">
        <div className="border-b border-border/70 px-4 py-3">
          <h2 className="text-base font-bold">Draft decision</h2>
          {syncState ? (
            <DraftSyncStatusIndicator sync={syncState} className="mt-2" />
          ) : null}
        </div>
        <DecisionLensSwitcher output={output} onChange={setSelectedLens} />
        <div className="p-5 text-center">
          <h3 className="font-bold">No pick available</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Recommendations will return when another player is available.
          </p>
        </div>
      </aside>
    );
  }

  const topPlayer = playerById.get(topPick.playerId);
  const diagnostics = topPick.diagnostics;
  const decisionFactors = topPick.decisionFactors;
  const alternatives = draftNow
    .filter((recommendation) => recommendation.playerId !== topPick.playerId)
    .slice(0, 2);
  const recommendationSourceLabel = output.selectedLens === 'best-player'
    ? 'Trusted ECR Anchor'
    : getRecommendationPolicyLabel(overall.selection);
  const recommendationSourceSummary = output.selectedLens === 'best-player'
    ? 'Best Player is ordered only by trusted ECR'
    : decisionFactors
      ? decisionFactors.conservativeBoundary.feasibilityException
        ? 'The normal ECR window had no legal-roster path, so roster feasibility set this pick'
        : `ECR anchored · league value capped at +${String(decisionFactors.leagueValue.maxScore)} · roster fit capped at +${String(decisionFactors.rosterFit.maxScore)} · tier supply capped at +${String(decisionFactors.tierSupply.maxScore)} · next-pick timing capped at +${String(decisionFactors.draftTiming.maxScore)} · normal ECR window ${String(output.bestPickView.selection.ecrNeighborhood ?? 8)}`
      : [
          'Core recommendation ECR anchored',
          dataInfo.shadowRecommendationAvailable
            ? 'Shadow Recommendation observing'
            : 'Shadow Recommendation unavailable',
          dataInfo.pickEvOverrideEnabled
            ? 'PickEV overrides on'
            : 'PickEV overrides off',
        ].join(' · ');
  const nextUserPickLabel = diagnostics?.nextPickLabel;

  return (
    <aside className="overflow-hidden rounded-xl border border-border/75 bg-card shadow-sm">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">
            {output.selectedLens === 'best-pick' ? 'Your Best Pick' : 'Best Player available'}
          </h2>
          <Badge
            variant="outline"
            className="bg-muted/40 text-[10px] text-foreground"
            title={dataInfo.recommendationPolicyReason}
          >
            {recommendationSourceLabel} · #1
          </Badge>
        </div>
        {syncState ? (
          <DraftSyncStatusIndicator sync={syncState} className="mt-2" />
        ) : null}
      </div>

      <DecisionLensSwitcher output={output} onChange={setSelectedLens} />

      <div className="p-4">
        <MotionIdentitySwap motionKey={topPick.playerId}>
          <div className="flex items-center gap-3">
            <PlayerHeadshot
              playerId={topPick.playerId}
              name={topPick.playerName}
              position={topPick.position}
              className="size-16 rounded-xl border border-emerald-500/25 bg-emerald-500/10"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold">{topPick.playerName}</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="font-mono font-bold text-sky-600 dark:text-sky-300">
                  {topPick.position}
                </span>
                {topPlayer?.team ? <span>· {topPlayer.team}</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px]">
                  Tier {String(diagnostics?.tier ?? '—')}
                </Badge>
                {topPlayer ? (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    #{String(topPlayer.positionalRank)} {topPick.position}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </MotionIdentitySwap>

          <dl className="mt-4 grid grid-cols-2 overflow-hidden border-y border-border/70 bg-muted/15">
            <div className="border-b border-r border-border/70 p-3">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Above replacement</dt>
              <dd className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-300">
                <MotionMetricSwap motionKey={diagnostics?.valueOverReplacement ?? 'none'}>
                  {diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'}
                </MotionMetricSwap>
              </dd>
            </div>
            <div className="border-b border-border/70 p-3">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Chance still available</dt>
              <dd className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-300">
                <MotionMetricSwap motionKey={`${String(diagnostics?.nextPickSurvivalProbability)}:${nextUserPickLabel ?? 'none'}`}>
                  {survivalPercent(diagnostics?.nextPickSurvivalProbability)}
                  {nextUserPickLabel ? (
                    <span className="text-xs font-semibold text-muted-foreground">
                      {' '}at pick {nextUserPickLabel}
                    </span>
                  ) : null}
                </MotionMetricSwap>
              </dd>
            </div>
            <div className="col-span-2 p-3">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Decision</dt>
              <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
                <MotionMetricSwap motionKey={overall.explanationByPlayerId.get(topPick.playerId) ?? topPick.reason}>
                  {overall.explanationByPlayerId.get(topPick.playerId) ?? topPick.reason}
                </MotionMetricSwap>
              </dd>
            </div>
            {output.selectedLens === 'best-pick' && decisionFactors ? (
              <div className="col-span-2 border-t border-border/70 p-3">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Policy factors</dt>
                <dd className="mt-2 grid grid-cols-2 overflow-hidden border-y border-border/70 bg-muted/25 text-center">
                  <span className="border-b border-r border-border/60 px-2 py-1.5">
                    <span className="block text-[9px] text-muted-foreground">Player quality</span>
                    <span className="font-mono text-xs font-bold">ECR #{String(decisionFactors.playerQuality.ecrRank)}</span>
                  </span>
                  <span className="border-b border-border/60 px-2 py-1.5">
                    <span className="block text-[9px] text-muted-foreground">League value</span>
                    <span className="font-mono text-xs font-bold">+{decisionFactors.leagueValue.score.toFixed(1)}</span>
                  </span>
                  <span className="border-b border-r border-border/60 px-2 py-1.5">
                    <span className="block text-[9px] text-muted-foreground">Roster fit</span>
                    <span className="font-mono text-xs font-bold">+{decisionFactors.rosterFit.score.toFixed(1)}</span>
                  </span>
                  <span
                    className={decisionFactors.tierSupply.materiallyChangedOrdering
                      ? 'border-b border-amber-500/45 bg-amber-500/10 px-2 py-1.5 text-amber-950 dark:text-amber-100'
                      : 'border-b border-border/60 px-2 py-1.5'}
                  >
                    <span className="block text-[9px] text-muted-foreground">Tier supply</span>
                    <span className="font-mono text-xs font-bold">+{decisionFactors.tierSupply.score.toFixed(1)}</span>
                  </span>
                  <span
                    className={decisionFactors.draftTiming.materiallyChangedOrdering
                      ? 'col-span-2 border-amber-500/45 bg-amber-500/10 px-2 py-1.5 text-amber-950 dark:text-amber-100'
                      : 'col-span-2 px-2 py-1.5'}
                  >
                    <span className="block text-[9px] text-muted-foreground">Next-pick timing</span>
                    <span className="font-mono text-xs font-bold">+{decisionFactors.draftTiming.score.toFixed(1)}</span>
                  </span>
                </dd>
                {decisionFactors.tierSupply.materiallyChangedOrdering ? (
                  <dd className="mt-2 border-l-2 border-amber-500/55 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
                    Tier supply changed Best Pick. {String(decisionFactors.tierSupply.remainingInTier)} left in {topPick.position} Tier {String(decisionFactors.tierSupply.currentTier)}; the next tier projects {decisionFactors.tierSupply.dropoffPoints.toFixed(1)} points lower, for a +{decisionFactors.tierSupply.costOfWaiting.toFixed(1)} cost of waiting.
                  </dd>
                ) : null}
                {decisionFactors.draftTiming.nextPickNumber !== undefined ? (
                  <dd className={decisionFactors.draftTiming.materiallyChangedOrdering
                    ? 'mt-2 border-l-2 border-amber-500/55 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100'
                    : 'mt-2 border-l-2 border-border/70 bg-muted/30 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground'}
                  >
                    <span className="font-semibold text-foreground">
                      {String(Math.round((decisionFactors.draftTiming.returnProbability ?? 0) * 100))}% at pick {decisionFactors.draftTiming.nextPickLabel ?? `#${String(decisionFactors.draftTiming.nextPickNumber)}`}.
                    </span>{' '}
                    {decisionFactors.draftTiming.expectedAlternative
                      ? `${decisionFactors.draftTiming.expectedAlternative.playerName} is the expected ${topPick.position} fallback at ${formatSignedNumber(decisionFactors.draftTiming.expectedAlternative.expectedValue, 0)} expected points above replacement.`
                      : `No ${topPick.position} fallback is projected for that selection.`}{' '}
                    Primary League history supplies 70% of the timing estimate, current consensus 25%, and Sleeper search rank 5%.
                    {decisionFactors.draftTiming.materiallyChangedOrdering
                      ? ' This next-pick tradeoff changed Best Pick.'
                      : ''}
                  </dd>
                ) : null}
              </div>
            ) : null}
          </dl>

        <div className="mt-4 grid gap-2">
          {sessionMode === 'mock' && canDraft && topPlayer ? (
            <Button onClick={() => { draftPlayer(topPlayer); }}>
              Draft {topPick.playerName}
            </Button>
          ) : sessionMode === 'mock' ? (
            <Button variant="outline" disabled>
              <Clock3 className="size-4" /> Waiting for your pick
            </Button>
          ) : (
            <div className="border-y border-border/70 bg-muted/25 px-3 py-2 text-center text-xs font-semibold text-muted-foreground">
              {sessionMode === 'live'
                ? 'Read-only · make the pick in Sleeper'
                : 'Preview only · start a mock to rehearse picks'}
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => {
              onOpenAssistant({ lens: 'compare', selectedPlayerId: topPick.playerId });
            }}
          >
            <GitCompareArrows className="size-4" /> Compare options
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenAssistant({ lens: 'why', selectedPlayerId: topPick.playerId });
            }}
          >
            <Lightbulb className="size-4" /> Ask why
          </Button>
        </div>
      </div>

      {alternatives.length > 0 ? (
        <div className="border-t border-border/70 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Other top options
          </div>
          <div className="space-y-2">
            {alternatives.map((recommendation) => {
              const player = playerById.get(recommendation.playerId);
              return (
                <button
                  key={recommendation.playerId}
                  type="button"
                  onClick={() => {
                    onOpenAssistant({
                      lens: 'why',
                      selectedPlayerId: recommendation.playerId,
                    });
                  }}
                  className="flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <PlayerHeadshot
                    playerId={recommendation.playerId}
                    name={recommendation.playerName}
                    position={recommendation.position}
                    className="size-10 rounded-lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{recommendation.playerName}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {recommendation.position}{player?.team ? ` · ${player.team}` : ''}
                    </span>
                  </span>
                  <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    {recommendation.diagnostics
                      ? formatSignedNumber(recommendation.diagnostics.valueOverReplacement, 0)
                      : '—'}
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex gap-2 border-t border-border/70 bg-muted/20 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <Database className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {recommendationSourceSummary}. Recommendations stay available between turns and refresh after every confirmed synced pick.
        </span>
      </div>
    </aside>
  );
}
