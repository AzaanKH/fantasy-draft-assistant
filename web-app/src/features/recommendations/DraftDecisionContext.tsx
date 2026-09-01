import * as React from 'react';
import {
  POSITIONS,
  type DecisionLens,
  type DraftReadinessReport,
  type Position,
} from '@fantasy-draft/shared';
import { useRecommendations } from '@/hooks/useRecommendations';
import { blocksRecommendations } from '@/lib/draft-readiness';
import { useDraftStore } from '@/stores/draftStore';
import type {
  DraftSessionMode,
  UnresolvedProviderPick,
} from '@/stores/draftStore';
import {
  createDraftDecisionOutput,
  type DraftDecisionOutput,
  type DraftDecisionView,
} from './draft-decision';

type RecommendationState = ReturnType<typeof useRecommendations>;

export interface DraftDecisionSnapshot extends RecommendationState {
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
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const unresolvedProviderPicks = useDraftStore(
    (state) => state.unresolvedProviderPicks
  );
  const recommendationsBlockedByProviderIdentity =
    blocksProviderIdentityRecommendations(
      sessionMode,
      unresolvedProviderPicks.length
    );
  const recommendationsBlocked =
    blocksRecommendations(sessionMode, readiness) ||
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
  const currentPick = useDraftStore((state) => state.currentPick);
  const selectedLens = useDraftStore((state) => state.decisionLens);
  const setSelectedLens = useDraftStore((state) => state.setDecisionLens);
  const historyLength = useDraftStore((state) => state.draftHistory.length);
  const rosterSize = useDraftStore((state) =>
    (Object.values(state.myRoster) as string[][]).reduce(
      (total, playerIds) => total + playerIds.length,
      0
    )
  );
  const output = React.useMemo(
    () => createDraftDecisionOutput(
      draftNow,
      selection,
      bestAvailable,
      selectedLens
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
        selectedLens
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
    setSelectedLens,
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
    setSelectedLens,
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
