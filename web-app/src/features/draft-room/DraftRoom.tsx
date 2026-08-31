import * as React from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { StatePulseDot } from '@/components/motion';
import { RouteSkeleton } from '@/components/skeletons';
import type { DraftReadinessReport } from '@fantasy-draft/shared';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { DraftConnect } from '@/features/draft-board/DraftConnect';
import { MockDraftControls } from '@/features/draft-board/MockDraftControls';
import { getPicksUntilMyTurn } from '@/features/draft-board/on-the-clock-utils';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { cn } from '@/lib/utils';
import { useDraftSessionMode, useDraftStore } from '@/stores/draftStore';
import { DraftBoard } from './DraftBoard';
import { DraftDecisionBar } from './DraftDecisionBar';
import { DraftDock } from './DraftDock';
import { useLiveDraftSync } from './LiveDraftSyncProvider';
import { ManualContinuityControl } from './ManualContinuityControl';
import { ReconciliationSummary } from './ReconciliationSummary';

function KeeperStatus({ status }: { readonly status: KeeperPreloadStatus }): React.ReactElement {
  const isReady = status.isMockReady;
  const message = status.isLoading
    ? 'Loading keeper assignments…'
    : status.isError
      ? 'Keeper assignments could not be loaded.'
      : status.duplicateNames.length > 0
        ? `${String(status.duplicateNames.length)} duplicate keeper entries need fixing.`
        : status.invalidAssignments.length > 0
          ? `${String(status.invalidAssignments.length)} keeper slots are invalid or duplicated.`
          : status.unresolvedNames.length > 0
            ? `${String(status.unresolvedNames.length)} keeper names still need resolution.`
      : !status.isConfirmed
        ? 'Confirm the keeper file before starting a mock.'
        : !status.isInitialized
          ? 'Waiting for the complete keeper list to load into the draft.'
          : `${String(status.canonicalCount)} keepers are reserved on the board.`;

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 border-b px-3 py-2 text-xs lg:min-w-[270px] lg:border-b-0 lg:border-r',
        isReady
          ? 'border-emerald-500/20 bg-emerald-500/[0.06]'
          : 'border-amber-500/25 bg-amber-500/[0.07]'
      )}
      role="status"
    >
      {isReady ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
      ) : (
        <CircleAlert className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      )}
      <div className="min-w-0 leading-tight">
        <div
          className={cn(
            'font-semibold',
            isReady
              ? 'text-emerald-800 dark:text-emerald-300'
              : 'text-amber-800 dark:text-amber-300'
          )}
        >
          {isReady ? 'Mock ready' : 'Mock setup'}
        </div>
        <div className="mt-0.5 truncate text-muted-foreground" title={message}>
          {message}
        </div>
      </div>
    </div>
  );
}

export function DraftRoom({
  keeperStatus,
  readiness,
  onOpenAssistant,
}: {
  readonly keeperStatus: KeeperPreloadStatus;
  readonly readiness: DraftReadinessReport;
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const { players, isLoading, dataInfo } = usePlayerDataQuery();
  const sessionMode = useDraftSessionMode();
  const { sync, synchronizationState } = useLiveDraftSync();
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const totalPicks = config.totalTeams * config.totalRounds;
  const picksUntilMyTurn = getPicksUntilMyTurn(
    currentPick,
    config.myPickPosition,
    config.totalTeams,
    config.totalRounds
  );
  const liveModeDotClass = {
    confirmed: 'text-emerald-500',
    complete: 'text-emerald-500',
    reconciling: 'text-sky-500',
    delayed: 'text-amber-500',
    'manual-continuity': 'text-amber-500',
    disconnected: 'text-muted-foreground/50',
  }[synchronizationState];

  if (isLoading) {
    return <RouteSkeleton route="draft" />;
  }

  const sessionLabel = sessionMode === 'mock'
    ? 'Mock draft'
    : sessionMode === 'live'
      ? synchronizationState === 'manual-continuity'
        ? 'Manual Continuity'
        : 'Live draft'
      : 'Draft room preview';

  return (
    <main className="w-full space-y-4 px-3 py-4 sm:px-4">
      <section className="flex min-h-12 flex-col gap-3 border-y border-border/65 bg-muted/20 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <StatePulseDot
              motionKey={`${sessionMode}:${synchronizationState}`}
              className={sessionMode === 'live' ? liveModeDotClass : 'text-muted-foreground/50'}
            />
            <span className="text-xs font-semibold text-muted-foreground">{sessionLabel}</span>
          </div>
          <div className="h-5 w-px bg-border" />
          <div className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">
            {currentPick > totalPicks
              ? 'Draft complete'
              : `Pick ${formatRoundPick(currentPick, config.totalTeams)} · #${String(currentPick)}`}
          </div>
          <div className="hidden h-5 w-px bg-border md:block" />
          <div className="text-xs text-muted-foreground">
            {String(config.totalTeams)} teams · {String(config.totalRounds)} rounds · Snake
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="hidden text-xs font-bold text-emerald-700 md:inline-flex dark:text-emerald-300">
            {picksUntilMyTurn === 0
              ? 'Your pick now'
              : picksUntilMyTurn === null
                ? 'Draft complete'
                : `Your pick in ${String(picksUntilMyTurn)}`}
          </span>
          <div className="hidden h-5 w-px bg-border md:block" />
          {sessionMode === 'live' ? (
            <DraftConnect
              fantasyProsRefreshedAt={dataInfo.fantasyProsRefreshedAt}
              sleeperFetchedAt={dataInfo.sleeperFetchedAt}
              fantasyProsSourceType={dataInfo.fantasyProsSourceType}
              predictionModelVersion={dataInfo.predictionModelVersion}
              predictionGeneratedAt={dataInfo.predictionGeneratedAt}
              shadowRecommendationAvailable={dataInfo.shadowRecommendationAvailable}
              recommendationPolicyReason={dataInfo.recommendationPolicyReason}
              dataFreshness={dataInfo.dataFreshness}
              readiness={readiness}
              variant="status-control"
            />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" />
              {sessionMode === 'mock' ? 'Mock active' : 'Preview ready'}
            </span>
          )}
          <MockDraftControls
            players={players}
            isMockReady={keeperStatus.isMockReady}
            sessionMode={sessionMode}
          />
        </div>
      </section>

      {sessionMode === 'live' && sync.reconciliationSummary ? (
        <ReconciliationSummary
          summary={sync.reconciliationSummary}
          totalTeams={config.totalTeams}
          onDismiss={sync.dismissReconciliationSummary}
        />
      ) : null}

      {sessionMode === 'live' ? <ManualContinuityControl /> : null}

      {/* The app-level LiveDraftSyncProvider owns the live query and EventSource.
          This setup surface can unmount without interrupting provider polling. */}
      {sessionMode === 'setup' ? (
        <section className="overflow-hidden rounded-xl border border-border/75 bg-card shadow-sm">
          <div className="grid lg:grid-cols-[max-content_minmax(0,1fr)] lg:items-stretch">
            <KeeperStatus status={keeperStatus} />
            <DraftConnect
              fantasyProsRefreshedAt={dataInfo.fantasyProsRefreshedAt}
              sleeperFetchedAt={dataInfo.sleeperFetchedAt}
              fantasyProsSourceType={dataInfo.fantasyProsSourceType}
              predictionModelVersion={dataInfo.predictionModelVersion}
              predictionGeneratedAt={dataInfo.predictionGeneratedAt}
              shadowRecommendationAvailable={dataInfo.shadowRecommendationAvailable}
              recommendationPolicyReason={dataInfo.recommendationPolicyReason}
              dataFreshness={dataInfo.dataFreshness}
              readiness={readiness}
              variant="strip"
            />
          </div>
        </section>
      ) : null}

      <div className="min-w-0 space-y-4">
        <div className="sticky top-[4.5rem] z-[35]">
          <DraftDecisionBar onOpenAssistant={onOpenAssistant} />
        </div>
        <DraftBoard />
        <DraftDock onOpenAssistant={onOpenAssistant} />
      </div>
    </main>
  );
}
