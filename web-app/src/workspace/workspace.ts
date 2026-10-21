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
  readonly dispose: () => void;
}

export function createWorkspace({ draftStore, connectionStore }: {
  readonly draftStore: DraftStoreApi;
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
    const state = draftStore.getState();
    const connection = connectionStore.getState();
    switch (command[0]) {
      case 'setSessionMode': { const [, ...args] = command; state.setSessionMode(...args); return; }
      case 'setLiveDraftSession': { const [, ...args] = command; state.setLiveDraftSession(...args); return; }
      case 'enterManualContinuity': { const [, ...args] = command; state.enterManualContinuity(...args); return; }
      case 'setConfig': { const [, ...args] = command; state.setConfig(...args); return; }
      case 'applyLeagueSettings': { const [, ...args] = command; state.applyLeagueSettings(...args); return; }
      case 'setRosterRequirements': { const [, ...args] = command; state.setRosterRequirements(...args); return; }
      case 'setMockSettings': { const [, ...args] = command; state.setMockSettings(...args); return; }
      case 'setMockAutoAdvancePaused': { const [, ...args] = command; state.setMockAutoAdvancePaused(...args); return; }
      case 'setMockSettingsOpen': { const [, ...args] = command; state.setMockSettingsOpen(...args); return; }
      case 'markPlayerDrafted': { const [, ...args] = command; state.markPlayerDrafted(...args); return; }
      case 'recordProvisionalPick': { const [, ...args] = command; return state.recordProvisionalPick(...args); }
      case 'correctProvisionalPick': { const [, ...args] = command; return state.correctProvisionalPick(...args); }
      case 'removeProvisionalPick': { const [, ...args] = command; return state.removeProvisionalPick(...args); }
      case 'reconcileSyncedPicks': { const [, ...args] = command; return state.reconcileSyncedPicks(...args); }
      case 'preloadKeepers': { const [, ...args] = command; state.preloadKeepers(...args); return; }
      case 'consumeKeeperAtCurrentPick': { const [, ...args] = command; state.consumeKeeperAtCurrentPick(...args); return; }
      case 'undoLastPick': { const [, ...args] = command; state.undoLastPick(...args); return; }
      case 'branchFromPick': { const [, ...args] = command; state.branchFromPick(...args); return; }
      case 'resetDraft': { const [, ...args] = command; state.resetDraft(...args); return; }
      case 'setMockSurvivalProbabilities': { const [, ...args] = command; state.setMockSurvivalProbabilities(...args); return; }
      case 'togglePlayerShortlisted': { const [, ...args] = command; state.togglePlayerShortlisted(...args); return; }
      case 'removePlayerFromShortlist': { const [, ...args] = command; state.removePlayerFromShortlist(...args); return; }
      case 'moveShortlistedPlayer': { const [, ...args] = command; state.moveShortlistedPlayer(...args); return; }
      case 'setDecisionLens': { const [, ...args] = command; state.setDecisionLens(...args); return; }
      case 'setPositionFilter': { const [, ...args] = command; state.setPositionFilter(...args); return; }
      case 'setSearchQuery': { const [, ...args] = command; state.setSearchQuery(...args); return; }
      case 'connection.startConnection': { const [, ...args] = command; connection.startConnection(...args); return; }
      case 'connection.confirmDraftPosition': { const [, ...args] = command; connection.confirmDraftPosition(...args); return; }
      case 'connection.restoreConnection': { const [, ...args] = command; connection.restoreConnection(...args); return; }
      case 'connection.setPrimaryLeagueSettings': { const [, ...args] = command; connection.setPrimaryLeagueSettings(...args); return; }
      case 'connection.setQuickMockSettings': { const [, ...args] = command; connection.setQuickMockSettings(...args); return; }
      case 'connection.disconnect': { const [, ...args] = command; connection.disconnect(...args); return; }
    }
    const unreachable: never = command;
    return unreachable;
  }
  return { draft: draftStore, connection: connectionStore, send, dispose: () => { unsubscribe(); draftStore.dispose(); } };
}
