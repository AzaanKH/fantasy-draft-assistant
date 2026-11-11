import * as React from 'react';
import type { Player } from '@fantasy-draft/shared/league';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { useLiveDraftSync } from './LiveDraftSyncProvider';
import { resolveEnterAction, type PoolEnterAction } from './pool-keyboard';

/**
 * Each suggestion's mode-aware action and the one call that takes it: Draft on your turn in a mock, the
 * Provisional Pick dialog during live Manual Continuity (never a direct submit), otherwise Queue. Mounted once for
 * the lists and the 1-4 keys (SuggestionActionsProvider), and by the Best Pick strip for its own action.
 *
 * `reportsFor` is passed to `useDraftPlayerAction`; `'external'` registers no reporter, for a caller that registers
 * its own or shows no inline failure.
 */
export function useSuggestionActions(suggestions: readonly Recommendation[], reportsFor: readonly string[] | 'external'): {
  readonly playerById: ReadonlyMap<string, Player>;
  readonly players: readonly Player[];
  readonly playersLoading: boolean;
  readonly queuedSet: ReadonlySet<string>;
  readonly actionById: ReadonlyMap<string, PoolEnterAction>;
  readonly draft: ReturnType<typeof useDraftPlayerAction>;
  readonly togglePlayerQueued: (playerId: string) => void;
  /** The card at `index` takes its action; false when there is no such card. The pick lock still applies. */
  readonly actOnSuggestion: (index: number) => boolean;
  readonly recordPlayerId: string | null;
  readonly setRecordPlayerId: (playerId: string | null) => void;
} {
  const { players, isLoading: playersLoading } = usePlayerDataQuery();
  const queuedPlayerIds = useDraftView((view) => view.shortlistedPlayerIds);
  const { togglePlayerQueued } = useQueueActions(players);
  const sessionMode = useDraftState((state) => state.sessionMode);
  const { synchronizationState } = useLiveDraftSync();
  const [recordPlayerId, setRecordPlayerId] = React.useState<string | null>(null);
  const draft = useDraftPlayerAction(reportsFor);
  const { canDraft, canDraftPlayer, draftPlayer, pickInFlight } = draft;
  const playerById = React.useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const queuedSet = React.useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  // The action ignores the pick lock, so a saving pick keeps its (disabled) Draft or Record button instead of
  // falling back to Queue; the buttons and shortcuts check the lock themselves.
  const actionById = React.useMemo(() => new Map(suggestions.map((recommendation): [string, PoolEnterAction] => [
    recommendation.playerId,
    resolveEnterAction({
      sessionMode,
      canDraftPlayer: canDraft && canDraftPlayer(recommendation),
      canRecordProvisional: sessionMode === 'live' && synchronizationState === 'manual-continuity',
      isQueued: queuedSet.has(recommendation.playerId),
    }),
  ])), [canDraft, canDraftPlayer, queuedSet, sessionMode, suggestions, synchronizationState]);
  const actOnSuggestion = React.useCallback((index: number): boolean => {
    const recommendation = Number.isInteger(index) && index >= 0 ? suggestions[index] : undefined;
    if (!recommendation) return false;
    const action = actionById.get(recommendation.playerId);
    if (pickInFlight && (action === 'draft' || action === 'record')) return true;
    const player = playerById.get(recommendation.playerId);
    if (action === 'draft' && player) draftPlayer(player);
    else if (action === 'record') setRecordPlayerId(recommendation.playerId);
    else if (action === 'queue') togglePlayerQueued(recommendation.playerId);
    return true;
  }, [actionById, draftPlayer, pickInFlight, playerById, suggestions, togglePlayerQueued]);
  return React.useMemo(
    () => ({ playerById, players, playersLoading, queuedSet, actionById, draft, togglePlayerQueued, actOnSuggestion, recordPlayerId, setRecordPlayerId }),
    [actOnSuggestion, actionById, draft, playerById, players, playersLoading, queuedSet, recordPlayerId, togglePlayerQueued]
  );
}
