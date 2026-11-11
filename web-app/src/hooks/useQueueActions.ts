import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { sendWorkspaceCommand } from '@/workspace/workspace-command';
import { useWorkspace } from '@/workspace/WorkspaceProvider';
import { getDraftView } from '@/workspace/useDraftView';
import { getPickLock } from '@/workspace/pick-in-flight';
import { takeInjectedHang } from '@/workspace/dev-fault-injection';
import type { Workspace } from '@/workspace/workspace';
import * as React from 'react';
import { toast } from 'sonner';

interface QueuePlayerIdentity {
  readonly id: string;
  readonly name: string;
}

/** A queue save that has not settled by then is reported as not saved, with Retry, like a pick save (15s). */
export const QUEUE_SAVE_TIMEOUT_MS = 15_000;

/** The toast id for a player's queue notice; every queue notice shares the `queue:` prefix. */
export const queueToastId = (playerId: string): string => `queue:${playerId}`;

/**
 * Queue notices still on screen, per draft store, so a draft switch can dismiss them: their Retry and Undo belong to
 * the draft they were shown in.
 */
const shownQueueToasts = new WeakMap<object, Set<string>>();
const watchedDrafts = new WeakSet();

function trackQueueToast(workspace: Pick<Workspace, 'draft'>, id: string): void {
  let ids = shownQueueToasts.get(workspace.draft);
  if (!ids) {
    ids = new Set();
    shownQueueToasts.set(workspace.draft, ids);
  }
  ids.add(id);
  if (watchedDrafts.has(workspace.draft)) return;
  watchedDrafts.add(workspace.draft);
  // Lives as long as the draft store, like the pick lock it listens to.
  getPickLock(workspace).onContextChange(() => {
    const open = shownQueueToasts.get(workspace.draft);
    if (!open) return;
    for (const toastId of open) toast.dismiss(toastId);
    open.clear();
  });
}

/**
 * Queue writes, with the same contract as pick saves. A write that fails or does not settle within 15 seconds shows a
 * notice that stays until it is retried or dismissed (never a toast that times out with its Retry). Retry and Undo
 * are bound to the draft they were created in: after another session, mode or a restart they do nothing, a late
 * answer from the old draft is ignored, and the old draft's queue notices are dismissed.
 */
export function useQueueActions(
  players: readonly QueuePlayerIdentity[]
): {
  readonly togglePlayerQueued: (playerId: string) => void;
  /** Adds only; a queued player stays queued. */
  readonly addPlayerToQueue: (playerId: string) => void;
  readonly removePlayerFromQueue: (playerId: string) => void;
} {
  const workspace = useWorkspace();
  const lock = getPickLock(workspace);
  const playerNameById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player.name])),
    [players]
  );

  /**
   * Saves `queued` for the player. Settles once: success, failure or the timeout, whichever comes first, and only
   * while the draft it started in is still the current one.
   */
  const saveQueued = React.useCallback((playerId: string, queued: boolean, onSaved?: () => void) => {
    if (!workspace.sendDurable) return;
    const context = lock.context();
    let settled = false;
    const state: { timer?: ReturnType<typeof setTimeout> } = {};
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(state.timer);
      if (lock.context() !== context) return;
      outcome();
    };
    state.timer = setTimeout(() => {
      settle(() => { showQueueFailureRef.current(playerId, queued, null); });
    }, QUEUE_SAVE_TIMEOUT_MS);
    void (takeInjectedHang('queue') ?? workspace.sendDurable(['setPlayerShortlisted', playerId, queued])).then(
      () => { settle(() => { onSaved?.(); }); },
      (error: unknown) => {
        // The durable writer has already published its generic save notice. This queue notice (or, for a late
        // answer after the timeout or a draft change, nothing) owns the failure, so clear it either way.
        workspace.dismissError?.();
        settle(() => { showQueueFailureRef.current(playerId, queued, error); });
      },
    );
  }, [lock, workspace]);

  /**
   * A queue save that failed or hung: say so with Retry and Dismiss, until one is chosen, so the Queue buttons and the
   * pool's Q key never look like they worked when nothing was saved. Shares the player's toast id, so it replaces
   * any "added" toast. `error` null means the save did not finish in time.
   */
  const showQueueFailure = React.useCallback((playerId: string, queued: boolean, error: unknown) => {
    const playerName = playerNameById.get(playerId) ?? 'Player';
    const action = queued ? 'added to' : 'removed from';
    const message = error === null
      ? `${playerName} may not have been ${action} your queue. The save did not finish within ${String(QUEUE_SAVE_TIMEOUT_MS / 1000)} seconds.`
      : `${playerName} was not ${action} your queue.${error instanceof Error && error.message ? ` ${error.message}` : ''}`;
    const id = queueToastId(playerId);
    // This notice is the failure's one surface; clear the generic save notice.
    workspace.dismissError?.();
    trackQueueToast(workspace, id);
    toast.error(message, {
      id,
      duration: Number.POSITIVE_INFINITY,
      action: { label: 'Retry', onClick: lock.bindRetry(() => { saveQueued(playerId, queued); }) },
      cancel: { label: 'Dismiss', onClick: () => { toast.dismiss(id); } },
    });
  }, [lock, playerNameById, saveQueued, workspace]);
  const showQueueFailureRef = React.useRef(showQueueFailure);
  React.useEffect(() => { showQueueFailureRef.current = showQueueFailure; }, [showQueueFailure]);

  const showQueueFeedback = React.useCallback((playerId: string, wasQueued: boolean) => {
    const playerName = playerNameById.get(playerId) ?? 'Player';
    const id = queueToastId(playerId);
    trackQueueToast(workspace, id);
    toast(`${playerName} ${wasQueued ? 'removed from' : 'added to'} queue`, {
      id,
      action: { label: 'Undo', onClick: lock.bindRetry(() => {
        if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) {
          saveQueued(playerId, wasQueued);
          return;
        }
        const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
        if (wasQueued && !isQueued) {
          sendWorkspaceCommand(workspace, 'togglePlayerShortlisted', playerId);
        } else if (!wasQueued && isQueued) {
          sendWorkspaceCommand(workspace, 'removePlayerFromShortlist', playerId);
        }
      }) },
    });
  }, [lock, playerNameById, saveQueued, workspace]);

  const togglePlayerQueued = React.useCallback((playerId: string) => {
    const wasQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
    if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) {
      saveQueued(playerId, !wasQueued, () => {
        const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
        if (wasQueued !== isQueued) showQueueFeedback(playerId, wasQueued);
      });
      return;
    }
    sendWorkspaceCommand(workspace, 'togglePlayerShortlisted', playerId);
    const isQueued = getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId);
    if (wasQueued !== isQueued) showQueueFeedback(playerId, wasQueued);
  }, [workspace, saveQueued, showQueueFeedback]);

  const addPlayerToQueue = React.useCallback((playerId: string) => {
    if (getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) return;
    togglePlayerQueued(playerId);
  }, [workspace, togglePlayerQueued]);

  const removePlayerFromQueue = React.useCallback((playerId: string) => {
    if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) return;
    if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) {
      saveQueued(playerId, false, () => {
        if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) showQueueFeedback(playerId, true);
      });
      return;
    }
    sendWorkspaceCommand(workspace, 'removePlayerFromShortlist', playerId);
    if (!getDraftView(workspace.draft).shortlistedPlayerIds.includes(playerId)) showQueueFeedback(playerId, true);
  }, [workspace, saveQueued, showQueueFeedback]);

  return { togglePlayerQueued, addPlayerToQueue, removePlayerFromQueue };
}
