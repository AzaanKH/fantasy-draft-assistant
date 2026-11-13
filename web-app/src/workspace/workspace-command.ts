import type { VoidWorkspaceCommand } from './commands';
import { getPickLock } from './pick-in-flight';
import { dispatchWorkspace } from './ui-dispatch';
import type { Workspace } from './workspace';

/** Fire-and-forget command. Durable failures surface through CommandNotice. */
export function sendWorkspaceCommand(workspace: Workspace, ...command: VoidWorkspaceCommand): void {
  // A restart is a new draft even when the old one had no picks: release any pending pick or queue save first.
  if (command[0] === 'resetDraft') getPickLock(workspace).reset();
  dispatchWorkspace(workspace, ...command);
}

/**
 * Awaitable command for UI that must not announce success early: resolves once the
 * command is committed and rejects when the durable save fails. A workspace with no durable writer stays synchronous.
 */
export async function commitWorkspaceCommand(workspace: Workspace, ...command: VoidWorkspaceCommand): Promise<void> {
  if (workspace.sendDurable) {
    await workspace.sendDurable(command);
    return;
  }
  workspace.send(...command);
}
