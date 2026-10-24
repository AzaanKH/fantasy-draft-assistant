import { dispatchDraftCommand } from './dispatch-command';
import type { StoreApi } from 'zustand';
import type { DraftStoreApi } from '@/stores/draftStore';
import type { DraftState, DraftReconciliationResult } from '@/stores/draft/types';
import { connectionReader, connectionHint, connectionPreferences, getConnection, type ConnectionQuery } from './connection';
import { isDraftPosition, type PersistedDraftSyncConnection } from './connection-hints';
import type { WorkspaceCommand, WorkspaceSend, VoidWorkspaceCommand } from './commands';

export type WorkspaceReader<T> = Pick<StoreApi<T>, 'getState' | 'getInitialState' | 'subscribe'>;
export interface Workspace {
  readonly status?: WorkspaceReader<import('./ui-dispatch').CommandStatus>;
  readonly dismissError?: () => void;
  readonly draft: WorkspaceReader<DraftState>;
  readonly connection: WorkspaceReader<ConnectionQuery>;
  readonly send: WorkspaceSend;
  readonly sendDurable?: (command: WorkspaceCommand | import('./draft-reducer').DraftCommand) => Promise<unknown>;
  readonly dispose: () => void;
}

export function createWorkspace({ draftStore, initialConnection = null, persist = () => {}, durable }: {
  readonly draftStore: DraftStoreApi;
  readonly durable?: (command: WorkspaceCommand | import('./draft-reducer').DraftCommand) => Promise<unknown>;
  readonly initialConnection?: PersistedDraftSyncConnection | null;
  readonly persist?: (connection: PersistedDraftSyncConnection | null) => void;
}): Workspace {
  let suspendedLive: DraftState | null = null;
  const connection = connectionReader(draftStore, state => state.sessionMode === 'mock' && suspendedLive ? suspendedLive : state);
  function applyHint(hint: PersistedDraftSyncConnection | null): void {
    if (!hint) suspendedLive = null;
    const current = getConnection(draftStore.getState());
    const same = current?.provider === hint?.provider && current?.draftId === hint?.draftId;
    draftStore.getState().setLiveDraftSession(hint);
    if (!hint) { draftStore.setState({ connectionPreferences: undefined }); return; }
    const state = draftStore.getState();
    const confirmed = state.sessionMode === 'live' || (same && state.connectionPreferences?.slotConfirmed === true);
    if (!confirmed && hint.draftPosition !== null) state.setConfig({ myPickPosition: hint.draftPosition });
    draftStore.setState({ connectionPreferences: connectionPreferences(hint, confirmed || hint.draftPosition !== null) });
  }
  if (initialConnection) applyHint(initialConnection);
  let projected = JSON.stringify(connection.getState().connection);
  const unsubscribe = draftStore.subscribe(() => {
    const next = connection.getState().connection; const serialized = JSON.stringify(next);
    if (serialized === projected) return;
    projected = serialized;
    if (next) persist(next);
  });
  if (initialConnection) persist(connection.getState().connection);

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
    if (command[0] === 'setSessionMode') {
      if (command[1] === 'mock' && state.liveSession) suspendedLive = state;
      else if (command[1] === 'live' && !state.liveSession && suspendedLive) state.setLiveDraftSession(suspendedLive.liveSession);
    }

    switch (command[0]) {
      case 'connection.applyProviderSettings': {
        const hint = command[1];
        if (state.liveSession?.provider !== hint.provider || state.liveSession.draftId !== hint.draftId) return;
        state.setConfig(hint.config); state.applyLeagueSettings(hint.leagueSettings); return;
      }
      case 'connection.startConnection':
      case 'connection.applyHint':
      case 'connection.restoreConnection':
      case 'connection.disconnect': {
        const hint = connectionHint(command, getConnection(state));
        if (hint !== undefined) {
          applyHint(hint);
          if (command[0] === 'connection.disconnect') persist(null);
        }
        return;
      }
      case 'connection.confirmDraftPosition': {
        if (!state.liveSession || !isDraftPosition(command[1])) return;
        state.setConfig({ myPickPosition: command[1] });
        draftStore.setState({ connectionPreferences: { ...state.connectionPreferences, slotConfirmed: true } });
        state.setSessionMode('live'); return;
      }
      case 'connection.setPrimaryLeagueSettings':
      case 'connection.setQuickMockSettings': {
        if (state.liveSession?.provider !== 'sleeper') return;
        const preferences = { slotConfirmed: state.sessionMode === 'live', ...state.connectionPreferences };
        if (command[0] === 'connection.setPrimaryLeagueSettings') {
          if (command[1]) { preferences.usePrimaryLeagueSettings = true; delete preferences.settingsProfile; }
          else delete preferences.usePrimaryLeagueSettings;
        } else {
          if (command[1]) { preferences.settingsProfile = 'quick-mock'; delete preferences.usePrimaryLeagueSettings; }
          else delete preferences.settingsProfile;
        }
        draftStore.setState({ connectionPreferences: preferences }); return;
      }
    }
    return dispatchDraftCommand(state, command);
  }
  return { draft: draftStore, connection, send, ...(durable ? { sendDurable: durable } : {}), dispose: () => { unsubscribe(); draftStore.dispose(); } };
}
