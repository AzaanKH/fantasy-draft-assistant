import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import type { VoidWorkspaceCommand } from './commands';
import { getPickLock } from './pick-in-flight';
import { dispatchWorkspace } from './ui-dispatch';
import type { Workspace } from './workspace';

/*
 * The one place UI chooses between the durable (storage activation) writer and the v1 store.
 * The branch sits on the build-time STORAGE_ACTIVATION_ENABLED constant, so OFF builds drop the
 * activation wrappers and OFF UI never enters them; ON goes through dispatchWorkspace.
 */

/** Fire-and-forget command. Durable failures surface through CommandNotice. */
export function sendWorkspaceCommand(workspace: Workspace, ...command: VoidWorkspaceCommand): void {
  // A restart is a new draft even when the old one had no picks: release any pending pick or queue save first.
  if (command[0] === 'resetDraft') getPickLock(workspace).reset();
  if (STORAGE_ACTIVATION_ENABLED) dispatchWorkspace(workspace, ...command);
  else workspace.send(...command);
}

/**
 * Awaitable command for UI that must not announce success early: resolves once the
 * command is committed and rejects when the durable save fails. OFF stays synchronous.
 */
export async function commitWorkspaceCommand(workspace: Workspace, ...command: VoidWorkspaceCommand): Promise<void> {
  if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) {
    await workspace.sendDurable(command);
    return;
  }
  workspace.send(...command);
}
