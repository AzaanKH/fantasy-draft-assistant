import * as React from 'react';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useShadowRecommendationLogging } from '@/hooks/useShadowRecommendationLogging';
import { useLiveDraftSync } from './LiveDraftSyncProvider';

export function ShadowRecommendationObserver(): React.ReactElement | null {
  const { connection, sync } = useLiveDraftSync();
  const { output, recommendationsBlocked } = useDraftDecision();

  useShadowRecommendationLogging({
    draftId: connection?.draftId ?? null,
    draftProvider: connection?.provider ?? null,
    draftReady:
      connection !== null &&
      connection.draftPosition !== null &&
      sync.isDrafting &&
      !recommendationsBlocked,
    coreBestPick: output.bestPick,
    coreBestPlayer: output.bestPlayer,
    coreRecommendations: output.bestPickView.recommendations,
    corePolicy: output.bestPickView.selection.policy,
  });

  return null;
}
