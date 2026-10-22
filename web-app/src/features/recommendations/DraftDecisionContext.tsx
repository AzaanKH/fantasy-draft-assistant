import { dispatchWorkspace } from '@/workspace/ui-dispatch';
import { useWorkspace, useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { DRAFT_DISPLAY } from '@/lib/demo-mode';
import * as React from 'react';
import {
  POSITIONS,
  type Position,
} from '@fantasy-draft/shared/league';
import {
  type DraftReadinessReport,
} from '@fantasy-draft/shared/catalog';
import {
  type DecisionLens,
} from '@fantasy-draft/shared/draft';
import { useRecommendations } from '@/hooks/useRecommendations';
import { blocksRecommendations, createDraftDecisionOutput, type DraftDecisionOutput, type DraftDecisionView } from '@fantasy-draft/shared/draft';
import { type DraftSessionMode, type UnresolvedProviderPick } from '@/stores/draftStore';

type RecommendationState = ReturnType<typeof useRecommendations>;

interface DraftDecisionSnapshot extends RecommendationState {
  readonly currentPick: number;
  readonly snapshotKey: string;
  readonly output: DraftDecisionOutput;
  readonly setSelectedLens: (lens: DecisionLens) => void;
  readonly overall: DraftDecisionView;
  readonly byPosition: Readonly<Record<Position, DraftDecisionView>>;
  readonly outputByPosition: Readonly<Record<Position, DraftDecisionOutput>>;
  readonly readiness: DraftReadinessReport | null;
  readonly recommendationsBlocked: boolean;
  readonly recommendationsBlockedByProviderIdentity: boolean;
  readonly unresolvedProviderPicks: readonly UnresolvedProviderPick[];
}

const DraftDecisionContext = React.createContext<DraftDecisionSnapshot | null>(null);

export function blocksProviderIdentityRecommendations(
  sessionMode: DraftSessionMode,
  unresolvedPickCount: number
): boolean {
  return sessionMode === 'live' && unresolvedPickCount > 0;
}

export function DraftDecisionProvider({
  children,
  readiness = null,
}: {
  readonly children: React.ReactNode;
  readonly readiness?: DraftReadinessReport | null;
}): React.ReactElement {
  const sessionMode = useDraftState((state) => state.sessionMode);
  const quickMockRules = useDraftState((state) => state.leagueSettings.source === 'default' && state.leagueSettings.keepersEnabled === false);
  const unresolvedProviderPicks = useDraftState(
    (state) => state.unresolvedProviderPicks
  );
  const recommendationsBlockedByProviderIdentity =
    blocksProviderIdentityRecommendations(
      sessionMode,
      unresolvedProviderPicks.length
    );
  const recommendationsBlocked =
    blocksRecommendations(sessionMode, readiness, quickMockRules) ||
    recommendationsBlockedByProviderIdentity;
  const recommendationState = useRecommendations(60, !recommendationsBlocked);
  const {
    draftNow,
    rbIntentionalReaches,
    bestAvailable,
    marketValues,
    marketStashes,
    byNeed,
    selection,
    positionRecommendationStates,
    topPick,
    isLoading,
  } = recommendationState;
  const currentPick = useDraftView((view) => view.currentPick);
  const selectedLens = useDraftState((state) => state.decisionLens);
  const workspace = useWorkspace();
  const historyLength = useDraftState((state) => state.draftHistory.length);
  const rosterSize = useDraftView((view) =>
    POSITIONS.map(position => view.myRoster[position]).reduce(
      (total, playerIds) => total + playerIds.length,
      0
    )
  );
  const output = React.useMemo(
    () => createDraftDecisionOutput(
      draftNow,
      selection,
      bestAvailable,
      selectedLens,
      DRAFT_DISPLAY
    ),
    [bestAvailable, draftNow, selectedLens, selection]
  );
  const outputByPosition = React.useMemo(() => {
    const decisions = {} as Record<Position, DraftDecisionOutput>;
    POSITIONS.forEach((position) => {
      const state = positionRecommendationStates[position];
      decisions[position] = createDraftDecisionOutput(
        state.recommendations,
        state.selection,
        state.bestAvailable,
        selectedLens,
        DRAFT_DISPLAY
      );
    });
    return decisions;
  }, [positionRecommendationStates, selectedLens]);
  const byPosition = React.useMemo(() => {
    const decisions = {} as Record<Position, DraftDecisionView>;
    POSITIONS.forEach((position) => {
      decisions[position] = outputByPosition[position].selectedView;
    });
    return decisions;
  }, [outputByPosition]);

  const value = React.useMemo<DraftDecisionSnapshot>(() => ({
    draftNow,
    rbIntentionalReaches,
    bestAvailable,
    marketValues,
    marketStashes,
    byNeed,
    selection,
    positionRecommendationStates,
    topPick,
    isLoading,
    output,
    setSelectedLens: (lens) => { dispatchWorkspace(workspace, 'setDecisionLens', lens); },
    overall: output.selectedView,
    byPosition,
    outputByPosition,
    readiness,
    recommendationsBlocked,
    recommendationsBlockedByProviderIdentity,
    unresolvedProviderPicks,
    currentPick,
    snapshotKey: `${String(currentPick)}:${String(historyLength)}:${String(rosterSize)}`,
  }), [
    bestAvailable,
    byNeed,
    byPosition,
    currentPick,
    draftNow,
    historyLength,
    isLoading,
    marketStashes,
    marketValues,
    output,
    outputByPosition,
    positionRecommendationStates,
    rbIntentionalReaches,
    readiness,
    recommendationsBlocked,
    recommendationsBlockedByProviderIdentity,
    rosterSize,
    selection,
    workspace,
    topPick,
    unresolvedProviderPicks,
  ]);

  return (
    <DraftDecisionContext.Provider value={value}>
      {children}
    </DraftDecisionContext.Provider>
  );
}

export function useDraftDecision(): DraftDecisionSnapshot {
  const context = React.useContext(DraftDecisionContext);
  if (!context) {
    throw new Error('useDraftDecision must be used inside DraftDecisionProvider');
  }
  return context;
}
