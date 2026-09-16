import * as React from 'react';
import { useUndoToast } from '@/components/undo-toast';
import { useDraftStoreApi } from '@/stores/draftStore';

interface QueuePlayerIdentity {
  readonly id: string;
  readonly name: string;
}

export function useQueueActions(
  players: readonly QueuePlayerIdentity[]
): {
  readonly togglePlayerQueued: (playerId: string) => void;
  readonly removePlayerFromQueue: (playerId: string) => void;
} {
  const showUndoToast = useUndoToast();
  const draftStore = useDraftStoreApi();
  const playerNameById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player.name])),
    [players]
  );

  const showQueueFeedback = React.useCallback((playerId: string, wasQueued: boolean) => {
    const playerName = playerNameById.get(playerId) ?? 'Player';
    showUndoToast({
      message: `${playerName} ${wasQueued ? 'removed from' : 'added to'} queue`,
      onUndo: () => {
        const current = draftStore.getState();
        const isQueued = current.shortlistedPlayerIds.includes(playerId);
        if (wasQueued && !isQueued) {
          current.togglePlayerShortlisted(playerId);
        } else if (!wasQueued && isQueued) {
          current.removePlayerFromShortlist(playerId);
        }
      },
    });
  }, [draftStore, playerNameById, showUndoToast]);

  const togglePlayerQueued = React.useCallback((playerId: string) => {
    const store = draftStore.getState();
    const wasQueued = store.shortlistedPlayerIds.includes(playerId);
    store.togglePlayerShortlisted(playerId);
    const isQueued = draftStore.getState().shortlistedPlayerIds.includes(playerId);
    if (wasQueued !== isQueued) showQueueFeedback(playerId, wasQueued);
  }, [draftStore, showQueueFeedback]);

  const removePlayerFromQueue = React.useCallback((playerId: string) => {
    const store = draftStore.getState();
    if (!store.shortlistedPlayerIds.includes(playerId)) return;
    store.removePlayerFromShortlist(playerId);
    showQueueFeedback(playerId, true);
  }, [draftStore, showQueueFeedback]);

  return { togglePlayerQueued, removePlayerFromQueue };
}
