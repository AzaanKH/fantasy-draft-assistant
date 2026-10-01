import * as React from 'react';
import { RouteSkeleton } from '@/components/skeletons';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { MockDraftControls } from '@/features/draft-board/MockDraftControls';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useDraftSessionMode, useDraftStore } from '@/stores/draftStore';
import { DraftBoard } from './DraftBoard';
import { DraftDecisionBar } from './DraftDecisionBar';
import { DraftDock } from './DraftDock';
import { useLiveDraftSync } from './LiveDraftSyncProvider';
import { ManualContinuityControl } from './ManualContinuityControl';
import { ReconciliationSummary } from './ReconciliationSummary';

export function DraftRoom({
  keeperStatus,
  onOpenAssistant,
}: {
  readonly keeperStatus: KeeperPreloadStatus;
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const { players, isLoading } = usePlayerDataQuery();
  const sessionMode = useDraftSessionMode();
  const { sync } = useLiveDraftSync();
  const config = useDraftStore((state) => state.config);
  if (isLoading) {
    return <RouteSkeleton route="draft" />;
  }

  return (
    <main className="draft-workspace w-full space-y-4 px-3 py-4 sm:px-4">
      {sessionMode === 'live' && sync.reconciliationSummary ? (
        <ReconciliationSummary
          summary={sync.reconciliationSummary}
          totalTeams={config.totalTeams}
          onDismiss={sync.dismissReconciliationSummary}
        />
      ) : null}

      {sessionMode === 'live' ? <ManualContinuityControl /> : null}

      <div className="min-w-0 space-y-4">
        <DraftBoard toolbarActions={sessionMode !== 'live'
          ? <MockDraftControls players={players} isMockReady={keeperStatus.isMockReady} sessionMode={sessionMode} />
          : undefined}
        />
        <DraftDecisionBar compact onOpenAssistant={onOpenAssistant} />
        <DraftDock onOpenAssistant={onOpenAssistant} />
      </div>
    </main>
  );
}
