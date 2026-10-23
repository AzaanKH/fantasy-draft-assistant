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
          workspace.send('togglePlayerShortlisted', playerId);
        } else if (!wasQueued && isQueued) {
          workspace.send('removePlayerFromShortlist', playerId);
        }
      } },
    });
  }, [workspace, playerNameById]);

  const togglePlayerQueued = React.useCallback((playerId: string) => {
    const wasQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
    workspace.send('togglePlayerShortlisted', playerId);
    const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
    if (wasQueued !== isQueued) showQueueFeedback(playerId, wasQueued);
  }, [workspace, showQueueFeedback]);

  const removePlayerFromQueue = React.useCallback((playerId: string) => {
    if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) return;
    workspace.send('removePlayerFromShortlist', playerId);
    if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) showQueueFeedback(playerId, true);
  }, [workspace, showQueueFeedback]);

  return { togglePlayerQueued, removePlayerFromQueue };
}
