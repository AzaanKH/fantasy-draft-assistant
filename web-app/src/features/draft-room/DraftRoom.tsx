import * as React from 'react';
import { RouteSkeleton } from '@/components/skeletons';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { MockDraftControls } from '@/features/draft-board/MockDraftControls';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useDraftSessionMode, useDraftStore } from '@/stores/draftStore';
import { DraftReadinessBlockedNotice } from './DraftReadinessBlockedNotice';
import { DraftWorkspace } from './DraftWorkspace';
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
  const { readiness, recommendationsBlocked } = useDraftDecision();
  if (isLoading) {
    return <RouteSkeleton route="draft" />;
  }

  return (
    <DraftWorkspace
      onOpenAssistant={onOpenAssistant}
      notices={(
        <>
          {recommendationsBlocked && readiness ? <DraftReadinessBlockedNotice readiness={readiness} /> : null}
          {sessionMode === 'live' && sync.reconciliationSummary ? (
            <ReconciliationSummary
              summary={sync.reconciliationSummary}
              totalTeams={config.totalTeams}
              onDismiss={sync.dismissReconciliationSummary}
            />
          ) : null}
          {sessionMode === 'live' ? <ManualContinuityControl /> : null}
        </>
      )}
      toolbarActions={sessionMode !== 'live'
        ? <MockDraftControls players={players} isMockReady={keeperStatus.isMockReady} sessionMode={sessionMode} />
        : undefined}
    />
  );
}
