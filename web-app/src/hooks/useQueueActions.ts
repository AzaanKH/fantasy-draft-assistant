import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
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
        if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) {
          void workspace.sendDurable(['setPlayerShortlisted', playerId, wasQueued]).catch(() => undefined);
          return;
        }
        const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
        if (wasQueued && !isQueued) {
          if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'togglePlayerShortlisted', playerId); } else { workspace.send('togglePlayerShortlisted', playerId); }
        } else if (!wasQueued && isQueued) {
          if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'removePlayerFromShortlist', playerId); } else { workspace.send('removePlayerFromShortlist', playerId); }
        }
      } },
    });
  }, [workspace, playerNameById]);

  const togglePlayerQueued = React.useCallback((playerId: string) => {
    const wasQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
    if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) {
      void workspace.sendDurable(['setPlayerShortlisted', playerId, !wasQueued]).then(() => {
        const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
        if (wasQueued !== isQueued) showQueueFeedback(playerId, wasQueued);
      }).catch(() => undefined);
      return;
    }
    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'togglePlayerShortlisted', playerId); } else { workspace.send('togglePlayerShortlisted', playerId); }
    const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
    if (wasQueued !== isQueued) showQueueFeedback(playerId, wasQueued);
  }, [workspace, showQueueFeedback]);

  const removePlayerFromQueue = React.useCallback((playerId: string) => {
    if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) return;
    if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) {
      void workspace.sendDurable(['setPlayerShortlisted', playerId, false]).then(() => {
        if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) showQueueFeedback(playerId, true);
      }).catch(() => undefined);
      return;
    }
    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'removePlayerFromShortlist', playerId); } else { workspace.send('removePlayerFromShortlist', playerId); }
    if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) showQueueFeedback(playerId, true);
  }, [workspace, showQueueFeedback]);

  return { togglePlayerQueued, removePlayerFromQueue };
}
