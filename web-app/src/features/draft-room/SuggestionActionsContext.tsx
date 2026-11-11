import * as React from 'react';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { ProvisionalPickDialog } from './ProvisionalPickDialog';
import { useSuggestionActions } from './useSuggestionActions';

/** Ranked suggestions shown at once, and the keys 1-4 that act on them. */
export const SUGGESTION_COUNT = 4;

export type SuggestionActions = ReturnType<typeof useSuggestionActions> & { readonly suggestions: readonly Recommendation[] };

const SuggestionActionsContext = React.createContext<SuggestionActions | null>(null);

/**
 * The workspace's one set of suggestion actions: the rendered lists and the page-wide 1-4 keys share it, so a press
 * and a click start the same save from the same origin. A list shows that origin's failures inline by registering
 * itself as a reporter while it is visible (`usePickFailureReporter`); with none registered, the workspace notice
 * shows them. A Record opens the one Provisional Pick dialog mounted here.
 */
export function SuggestionActionsProvider({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  const { overall } = useDraftDecision();
  const recommendations = overall.recommendations;
  const suggestions = React.useMemo(() => recommendations.slice(0, SUGGESTION_COUNT), [recommendations]);
  const actions = useSuggestionActions(suggestions, 'external');
  const value = React.useMemo((): SuggestionActions => ({ ...actions, suggestions }), [actions, suggestions]);
  const { recordPlayerId, setRecordPlayerId } = actions;
  return (
    <SuggestionActionsContext.Provider value={value}>
      {children}
      {recordPlayerId ? (
        <ProvisionalPickDialog open initialPlayerId={recordPlayerId} onOpenChange={(open) => { if (!open) setRecordPlayerId(null); }} />
      ) : null}
    </SuggestionActionsContext.Provider>
  );
}

/** The shared actions, or null outside a provider (a component rendered on its own then provides them itself). */
export function useSharedSuggestionActions(): SuggestionActions | null {
  return React.useContext(SuggestionActionsContext);
}

/** Renders `children` inside the workspace's provider, adding one only when none is mounted above. */
export function WithSuggestionActions({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return useSharedSuggestionActions() ? <>{children}</> : <SuggestionActionsProvider>{children}</SuggestionActionsProvider>;
}
