import { dispatchDraftCommand } from './dispatch-command';
import type { StoreApi } from 'zustand';
import type { DraftStoreApi } from '@/stores/draftStore';
import type { DraftState, DraftReconciliationResult } from '@/stores/draft/types';
import type { DraftSyncConnectionStore } from '@/stores/draftSyncStore';
import type { WorkspaceCommand, WorkspaceSend, VoidWorkspaceCommand } from './commands';

export type WorkspaceReader<T> = Pick<StoreApi<T>, 'getState' | 'getInitialState' | 'subscribe'>;
export interface Workspace {
  readonly draft: WorkspaceReader<DraftState>;
  readonly connection: WorkspaceReader<Pick<DraftSyncConnectionStore, 'connection'>>;
  readonly send: WorkspaceSend;
  readonly sendDurable?: (command: WorkspaceCommand | import('./draft-reducer').DraftCommand) => Promise<unknown>;
  readonly dispose: () => void;
}

export function createWorkspace({ draftStore, connectionStore, durable }: {
  readonly draftStore: DraftStoreApi;
  readonly durable?: (command: WorkspaceCommand | import('./draft-reducer').DraftCommand) => Promise<unknown>;
  readonly connectionStore: StoreApi<DraftSyncConnectionStore>;
}): Workspace {
  draftStore.getState().setLiveDraftSession(connectionStore.getState().connection);
  const unsubscribe = connectionStore.subscribe(({ connection }) => {
    draftStore.getState().setLiveDraftSession(connection);
  });

  function send(...command: VoidWorkspaceCommand): void;
  function send(...command: WorkspaceCommand<'recordProvisionalPick' | 'correctProvisionalPick' | 'removeProvisionalPick'>): boolean;
  function send(...command: WorkspaceCommand<'reconcileSyncedPicks'>): DraftReconciliationResult;
  function send(...command: WorkspaceCommand): unknown {
    if (durable) {
      if (command[0] === 'reconcileSyncedPicks') return { refused: true, changed: false, confirmations: [], corrections: [], removals: [] };
      if (command[0] === 'recordProvisionalPick' || command[0] === 'correctProvisionalPick' || command[0] === 'removeProvisionalPick') return false;
      return undefined;
    }
    const state = draftStore.getState();
    const connection = connectionStore.getState();
    switch (command[0]) {
      case 'connection.startConnection': { const [, ...args] = command; connection.startConnection(...args); return; }
      case 'connection.confirmDraftPosition': { const [, ...args] = command; connection.confirmDraftPosition(...args); return; }
      case 'connection.restoreConnection': { const [, ...args] = command; connection.restoreConnection(...args); return; }
      case 'connection.setPrimaryLeagueSettings': { const [, ...args] = command; connection.setPrimaryLeagueSettings(...args); return; }
      case 'connection.setQuickMockSettings': { const [, ...args] = command; connection.setQuickMockSettings(...args); return; }
      case 'connection.disconnect': { const [, ...args] = command; connection.disconnect(...args); return; }
    }
    return dispatchDraftCommand(state, command);
  }
  return { draft: draftStore, connection: connectionStore, send, ...(durable ? { sendDurable: durable } : {}), dispose: () => { unsubscribe(); draftStore.dispose(); } };
}
