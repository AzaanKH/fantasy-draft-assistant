import { createStore } from 'zustand/vanilla';
import { createDraftStore } from '@/stores/draftStore';
import { isDraftSessionIdentity } from '@fantasy-draft/shared/sync';
import type { DraftState } from '@/stores/draft/types';
import type { DraftSessionIdentity, PersistedDraftSession } from '@/stores/draftSessionStorage';
import {
  resolveInitialConnection, isDraftPosition, persistConnection, readStoredConnection,
  type PersistedDraftSyncConnection,
} from '@/workspace/connection-hints';
import { connectionHint, connectionPreferences, getConnection, type ConnectionQuery } from './connection';
import type { WorkspaceCommand } from './commands';
import { dispatchDraftCommand } from './dispatch-command';
import { initialDraftState, stateFromSession, type DraftCommand } from './draft-reducer';
import type { DraftDatabase } from './indexed-db';
import { createIndexedWorkspace, type IndexedWorkspace } from './indexed-workspace';
import type { Workspace } from './workspace';

const localFields = (state: DraftState) => ({
  filter: state.filter, mockSettings: state.mockSettings, mockAutoAdvance: state.mockAutoAdvance,
  mockSurvivalProbabilities: state.mockSurvivalProbabilities, connectionPreferences: state.connectionPreferences,
});
const sameIdentity = (left: DraftSessionIdentity | null, right: DraftSessionIdentity | null): boolean =>
  left?.provider === right?.provider && left?.draftId === right?.draftId;

type DurableReceipt = { result: unknown; session: PersistedDraftSession | null };
type Binding = { publishedRevision: number; identity: DraftSessionIdentity; indexed: IndexedWorkspace; seed: DraftState; unsubscribe: () => void };

export function createDurableWorkspace({ database, search, initialConnection = readStoredConnection(), resumeConfirmedConnection = false, onError = () => {} }: {
  database: DraftDatabase;
  search: string;
  initialConnection?: PersistedDraftSyncConnection | null;
  resumeConfirmedConnection?: boolean;
  onError?: (error: unknown) => void;
}): Omit<Workspace, 'sendDurable'> & { readonly ready: Promise<void>; sendDurable: (command: WorkspaceCommand | DraftCommand) => Promise<DurableReceipt> } {
  const draft = createDraftStore({ storage: null });
  const connection = createStore<ConnectionQuery>(() => ({ connection: getConnection(draft.getState()) }));
  const initial = resolveInitialConnection(search, initialConnection);
  let binding: Binding | null = null;
  let disposed = false;
  let memoryState: DraftState | null = null;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('fantasy-draft-workspace-v2') : null;

  function publishConnection(): void {
    const state = draft.getState();
    const next = getConnection(state.sessionMode === 'mock' && binding
      ? { ...binding.indexed.draft.getState(), connectionPreferences: state.connectionPreferences } : state);
    if (JSON.stringify(next) !== JSON.stringify(connection.getState().connection)) connection.setState({ connection: next }, true);
  }
  const unsubscribeConnection = draft.subscribe(publishConnection);

  let projected: string | undefined;
  function persistProjection(disconnect = false): void {
    const next = connection.getState().connection; const serialized = JSON.stringify(next);
    if (disconnect) { projected = serialized; persistConnection(null); return; }
    if (serialized === projected) return;
    projected = serialized;
    if (next) persistConnection(next);
  }
  function assertOpen(): void { if (disposed) throw new Error('Workspace is disposed'); }
  function releaseBinding(): void {
    binding?.unsubscribe();
    binding?.indexed.dispose();
    binding = null;
  }
  function install(identity: DraftSessionIdentity, state: DraftState): void {
    releaseBinding();
    const indexed = createIndexedWorkspace({ database, identity, report: onError, closeDatabase: false, initialState: { ...state, connectionPreferences: undefined } });
    const next: Binding = { publishedRevision: -1, identity, indexed, seed: state, unsubscribe: () => {} };
    next.unsubscribe = indexed.draft.subscribe(value => {
      if (disposed || binding !== next) return;
      if (draft.getState().sessionMode === 'live') draft.setState({ ...value, connectionPreferences: draft.getState().connectionPreferences });
      publishConnection();
    });
    binding = next;
  }
  async function bind(requested: DraftSessionIdentity | null): Promise<PersistedDraftSession | null> {
    assertOpen();
    if (requested && !isDraftSessionIdentity(requested)) throw new Error('Invalid draft session identity');
    const identity = requested ? { provider: requested.provider, draftId: requested.draftId } : null;
    if (sameIdentity(binding?.identity ?? null, identity)) return binding ? binding.indexed.readPersisted() : null;
    const session = identity ? await database.read(identity) : null;
    assertOpen();
    const previous = draft.getState();
    if (previous.sessionMode !== 'live') memoryState = previous;
    if (identity) {
      const state = { ...(session ? stateFromSession(session) : initialDraftState(identity)), ...localFields(previous), connectionPreferences: undefined };
      install(identity, state);
      draft.setState({ ...state, sessionMode: session ? 'live' : 'setup' });
    } else {
      releaseBinding();
      if (memoryState) draft.setState({ ...memoryState, liveSession: null, ...localFields(previous) });
      else draft.getState().setLiveDraftSession(null);
    }
    return session;
  }
  async function changeConnection(next: PersistedDraftSyncConnection | null, disconnect = false): Promise<DurableReceipt> {
    const current = getConnection(draft.getState());
    const same = current?.provider === next?.provider && current?.draftId === next?.draftId;
    const session = await bind(next);
    assertOpen();
    if (next) {
      const state = draft.getState();
      const confirmed = session !== null || (same && state.connectionPreferences?.slotConfirmed === true);
      if (!confirmed && next.draftPosition !== null) state.setConfig({ myPickPosition: next.draftPosition });
      draft.setState({ connectionPreferences: connectionPreferences(next, confirmed || next.draftPosition !== null) });
      if (binding && state.sessionMode === 'setup') binding.seed = draft.getState();
    } else draft.setState({ connectionPreferences: undefined });
    persistProjection(disconnect);
    return { result: undefined, session };
  }

  const initialized = Promise.resolve().then(async () => {
    await changeConnection(initial);
    if (resumeConfirmedConnection && connection.getState().connection?.draftPosition != null) await execute(['setSessionMode', 'live']);
  });
  void initialized.catch(onError);
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const pending = tail.then(async () => { await initialized; assertOpen(); return run(); });
    tail = pending.catch(() => {});
    return pending;
  }

  async function execute(command: WorkspaceCommand | DraftCommand): Promise<DurableReceipt> {
    switch (command[0]) {
      case 'connection.applyProviderSettings': {
        const hint = command[1];
        if (binding?.identity.provider !== hint.provider || binding.identity.draftId !== hint.draftId) return { result: undefined, session: null };
        await execute(['setConfig', hint.config]);
        return execute(['applyLeagueSettings', hint.leagueSettings]);
      }
      case 'connection.startConnection':
      case 'connection.applyHint':
      case 'connection.restoreConnection':
      case 'connection.disconnect': {
        const next = connectionHint(command, getConnection(draft.getState()));
        return next === undefined ? { result: undefined, session: null } : changeConnection(next, command[0] === 'connection.disconnect');
      }
      case 'connection.confirmDraftPosition': {
        if (!binding || !isDraftPosition(command[1])) return { result: undefined, session: null };
        const receipt = await execute(['confirmDraftSlot', command[1]]);
        draft.setState({ connectionPreferences: { ...draft.getState().connectionPreferences, slotConfirmed: true } });
        persistProjection();
        return receipt;
      }
      case 'connection.setPrimaryLeagueSettings':
      case 'connection.setQuickMockSettings': {
        const current = getConnection(draft.getState());
        if (current?.provider !== 'sleeper') return { result: undefined, session: null };
        const next = { ...current };
        if (command[0] === 'connection.setPrimaryLeagueSettings') {
          if (command[1]) { next.usePrimaryLeagueSettings = true; delete next.settingsProfile; }
          else delete next.usePrimaryLeagueSettings;
        } else {
          if (command[1]) { next.settingsProfile = 'quick-mock'; delete next.usePrimaryLeagueSettings; }
          else delete next.settingsProfile;
        }
        draft.setState({ connectionPreferences: connectionPreferences(next, current.draftPosition !== null) });
        if (binding && draft.getState().sessionMode === 'setup') binding.seed = draft.getState();
        persistProjection();
        return { result: undefined, session: null };
      }
      case 'setLiveDraftSession': return { result: undefined, session: await bind(command[1]) };
    }
    if (command[0] === 'confirmDraftSlot' && binding && draft.getState().sessionMode !== 'live') {
      install(binding.identity, { ...binding.seed, ...localFields(draft.getState()), sessionMode: 'live' });
    }
    if (command[0] === 'setSessionMode') {
      if (command[1] === 'live' && !binding) throw new Error('Connect a draft before entering live mode');
      if (command[1] === 'live' && binding) {
        const previous = draft.getState();
        if (previous.sessionMode !== 'live') {
          memoryState = previous;
          const latest = await database.read(binding.identity);
          assertOpen();
          const seed = previous.sessionMode === 'mock' ? binding.seed : previous;
          install(binding.identity, { ...(latest ? stateFromSession(latest) : seed), ...localFields(previous),
            liveSession: binding.identity, sessionMode: 'live' });
        }
      } else {
        if (draft.getState().sessionMode === 'live') {
          if (memoryState) draft.setState({ ...memoryState, ...localFields(draft.getState()) });
          else draft.setState({ liveSession: null });
        }
        dispatchDraftCommand(draft.getState(), command);
        return { result: undefined, session: null };
      }
    }
    if (binding && (command[0] === 'confirmDraftSlot' || draft.getState().sessionMode === 'live' || (command[0] === 'setSessionMode' && command[1] === 'live'))) {
      const receipt = await binding.indexed.commit(...command);
      assertOpen();
      draft.setState({ ...binding.indexed.draft.getState(), connectionPreferences: draft.getState().connectionPreferences });
      if (receipt.session.revision > binding.publishedRevision) {
        binding.publishedRevision = receipt.session.revision;
        try { channel?.postMessage(binding.identity); } catch (error) { onError(error); }
      }
      persistProjection();
      return receipt;
    }
    const result = dispatchDraftCommand(draft.getState(), command, () => draft.getState().shortlistedPlayerIds);
    if (binding && draft.getState().sessionMode === 'setup') binding.seed = draft.getState();
    return { result, session: null };
  }

  function sendDurable(command: WorkspaceCommand | DraftCommand): Promise<DurableReceipt> {
    return enqueue(() => execute(command)).catch((error: unknown) => { onError(error); throw error; });
  }
  const reread = (): void => {
    void enqueue(async () => {
      const active = binding;
      if (active) await active.indexed.refresh();
    }).catch(onError);
  };
  const visible = (): void => { if (document.visibilityState === 'visible') reread(); };
  if (typeof window !== 'undefined') window.addEventListener('focus', reread);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
  channel?.addEventListener('message', reread);

  return {
    ready: initialized,
    draft: { getState: draft.getState, getInitialState: draft.getInitialState, subscribe: draft.subscribe },
    connection: { getState: connection.getState, getInitialState: connection.getInitialState, subscribe: connection.subscribe },
    send: () => { throw new Error('Use sendDurable for an activated workspace'); },
    sendDurable,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (typeof window !== 'undefined') window.removeEventListener('focus', reread);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
      channel?.removeEventListener('message', reread);
      channel?.close();
      unsubscribeConnection();
      releaseBinding();
      draft.dispose();
      database.close();
    },
  };
}
