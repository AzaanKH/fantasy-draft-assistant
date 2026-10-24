import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { createStore } from 'zustand/vanilla';
import type { DraftReconciliationResult } from '@/stores/draft/types';
import type { Workspace } from './workspace';
import type { WorkspaceCommand, VoidWorkspaceCommand } from './commands';

export interface CommandStatus { readonly pending: number; readonly error: string | null }

/** The workspace owns reporting so callbacks cannot announce an uncommitted save. */
export function observeDurableWorkspace(workspace: Workspace): Workspace {
  const durable = workspace.sendDurable;
  if (!durable) return workspace;
  const status = createStore<CommandStatus>(() => ({ pending: 0, error: null }));
  return { ...workspace, status, dismissError: () => { status.setState({ error: null }); }, async sendDurable(command) {
    status.setState(state => ({ pending: state.pending + 1 }));
    try { return await durable(command); }
    catch (error) {
      status.setState({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { status.setState(state => ({ pending: state.pending - 1 })); }
  } };
}

export function dispatchWorkspace(workspace: Workspace, ...command: VoidWorkspaceCommand): void {
  if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) {
    void workspace.sendDurable(command).catch(() => undefined);
  } else workspace.send(...command);
}

type ResultCommand = 'recordProvisionalPick' | 'correctProvisionalPick' | 'removeProvisionalPick' | 'reconcileSyncedPicks';

export function requestWorkspace(workspace: Workspace, ...command: WorkspaceCommand<Exclude<ResultCommand, 'reconcileSyncedPicks'>>): boolean | Promise<boolean>;
export function requestWorkspace(workspace: Workspace, ...command: WorkspaceCommand<'reconcileSyncedPicks'>): DraftReconciliationResult | Promise<DraftReconciliationResult>;
export function requestWorkspace(workspace: Workspace, ...command: WorkspaceCommand<ResultCommand>): boolean | DraftReconciliationResult | Promise<boolean | DraftReconciliationResult> {
  if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) return workspace.sendDurable(command).then(receipt => {
    if (receipt === null || typeof receipt !== 'object' || !('result' in receipt)) throw new Error('A durable command completed without a receipt');
    const result: unknown = receipt.result;
    if (command[0] !== 'reconcileSyncedPicks') {
      if (typeof result !== 'boolean') throw new Error('The pick receipt has no acceptance result');
      return result;
    }
    if (result === null || typeof result !== 'object' || !('changed' in result) || typeof result.changed !== 'boolean' ||
        !('confirmations' in result) || !Array.isArray(result.confirmations) || !('corrections' in result) || !Array.isArray(result.corrections) ||
        !('removals' in result) || !Array.isArray(result.removals)) throw new Error('The reconciliation receipt is invalid');
    return result as DraftReconciliationResult;
  });
  switch (command[0]) {
    case 'recordProvisionalPick': return workspace.send('recordProvisionalPick', command[1]);
    case 'correctProvisionalPick': return workspace.send('correctProvisionalPick', command[1], command[2]);
    case 'removeProvisionalPick': return workspace.send('removeProvisionalPick', command[1]);
    case 'reconcileSyncedPicks': return workspace.send('reconcileSyncedPicks', command[1], command[2], command[3], command[4]);
  }
}
