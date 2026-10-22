import { dispatchWorkspace } from '@/workspace/ui-dispatch';
import { useWorkspace } from '@/workspace/WorkspaceProvider';
import { getDraftView } from '@/workspace/useDraftView';
import * as React from 'react';
import { toast } from 'sonner';

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
  const workspace = useWorkspace();
  const playerNameById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player.name])),
    [players]
  );

  const showQueueFeedback = React.useCallback((playerId: string, wasQueued: boolean) => {
    const playerName = playerNameById.get(playerId) ?? 'Player';
    toast(`${playerName} ${wasQueued ? 'removed from' : 'added to'} queue`, {
      id: `queue:${playerId}`,
      action: { label: 'Undo', onClick: () => {
        const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
        if (wasQueued && !isQueued) {
          dispatchWorkspace(workspace, 'togglePlayerShortlisted', playerId);
        } else if (!wasQueued && isQueued) {
          dispatchWorkspace(workspace, 'removePlayerFromShortlist', playerId);
        }
      } },
    });
  }, [workspace, playerNameById]);

  const togglePlayerQueued = React.useCallback((playerId: string) => {
    const wasQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
    if (workspace.sendDurable) {
      void workspace.sendDurable(['togglePlayerShortlisted', playerId]).then(() => {
        const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
        if (wasQueued !== isQueued) showQueueFeedback(playerId, wasQueued);
      }).catch(() => undefined);
      return;
    }
    dispatchWorkspace(workspace, 'togglePlayerShortlisted', playerId);
    const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
    if (wasQueued !== isQueued) showQueueFeedback(playerId, wasQueued);
  }, [workspace, showQueueFeedback]);

  const removePlayerFromQueue = React.useCallback((playerId: string) => {
    if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) return;
    if (workspace.sendDurable) {
      void workspace.sendDurable(['removePlayerFromShortlist', playerId]).then(() => {
        if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) showQueueFeedback(playerId, true);
      }).catch(() => undefined);
      return;
    }
    dispatchWorkspace(workspace, 'removePlayerFromShortlist', playerId);
    if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) showQueueFeedback(playerId, true);
  }, [workspace, showQueueFeedback]);

  return { togglePlayerQueued, removePlayerFromQueue };
}
