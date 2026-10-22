import { createDraftStore } from '@/stores/draftStore';
import { isDraftSessionIdentity } from '@fantasy-draft/shared/sync';
import type { DraftState } from '@/stores/draft/types';
import type { DraftSessionIdentity, PersistedDraftSession } from '@/stores/draftSessionStorage';
import {
  createDraftSyncConnectionStore, initializeDraftSyncConnection, persistConnection, readStoredConnection,
  type PersistedDraftSyncConnection,
} from '@/stores/draftSyncStore';
import type { WorkspaceCommand } from './commands';
import { dispatchDraftCommand } from './dispatch-command';
import { initialDraftState, stateFromSession, type DraftCommand } from './draft-reducer';
import type { DraftDatabase } from './indexed-db';
import { createIndexedWorkspace, type IndexedWorkspace } from './indexed-workspace';
import type { Workspace } from './workspace';

const localFields = (state: DraftState) => ({
  filter: state.filter, mockSettings: state.mockSettings, mockAutoAdvance: state.mockAutoAdvance,
  mockSurvivalProbabilities: state.mockSurvivalProbabilities,
});
const sameIdentity = (left: DraftSessionIdentity | null, right: DraftSessionIdentity | null): boolean =>
  left?.provider === right?.provider && left?.draftId === right?.draftId;

type DurableReceipt = { result: unknown; session: PersistedDraftSession | null };
type Binding = { publishedRevision: number; identity: DraftSessionIdentity; indexed: IndexedWorkspace; seed: DraftState; unsubscribe: () => void };

export function createDurableWorkspace({ database, search, initialConnection = readStoredConnection(), onError = () => {} }: {
  database: DraftDatabase;
  search: string;
  initialConnection?: PersistedDraftSyncConnection | null;
  onError?: (error: unknown) => void;
}): Omit<Workspace, 'sendDurable'> & { sendDurable: (command: WorkspaceCommand | DraftCommand) => Promise<DurableReceipt> } {
  const draft = createDraftStore({ storage: null });
  const connection = createDraftSyncConnectionStore({ initialConnection: null, persist: () => {} });
  const initial = createDraftSyncConnectionStore({ initialConnection, persist: () => {} });
  initializeDraftSyncConnection(initial, search);
  let binding: Binding | null = null;
  let disposed = false;
  let memoryState: DraftState | null = null;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('fantasy-draft-workspace-v2') : null;

  function assertOpen(): void { if (disposed) throw new Error('Workspace is disposed'); }
  function releaseBinding(): void {
    binding?.unsubscribe();
    binding?.indexed.dispose();
    binding = null;
  }
  function install(identity: DraftSessionIdentity, state: DraftState): void {
    releaseBinding();
    const indexed = createIndexedWorkspace({ database, identity, report: onError, closeDatabase: false, initialState: state });
    const next: Binding = { publishedRevision: -1, identity, indexed, seed: state, unsubscribe: () => {} };
    next.unsubscribe = indexed.draft.subscribe(value => {
      if (!disposed && binding === next && draft.getState().sessionMode === 'live') draft.setState(value);
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
      const state = { ...(session ? stateFromSession(session) : initialDraftState(identity)), ...localFields(previous) };
      install(identity, state);
      draft.setState({ ...state, sessionMode: session ? 'live' : 'setup' });
    } else {
      releaseBinding();
      if (memoryState) draft.setState({ ...memoryState, liveSession: null, ...localFields(previous) });
      else draft.getState().setLiveDraftSession(null);
    }
    return session;
  }
  async function changeConnection(next: PersistedDraftSyncConnection | null): Promise<DurableReceipt> {
    const session = await bind(next);
    assertOpen();
    persistConnection(next);
    connection.setState({ connection: next });
    return { result: undefined, session };
  }

  const initialized = Promise.resolve().then(() => changeConnection(initial.getState().connection));
  void initialized.catch(onError);
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const pending = tail.then(async () => { await initialized; assertOpen(); return run(); });
    tail = pending.catch(() => {});
    return pending;
  }

  async function execute(command: WorkspaceCommand | DraftCommand): Promise<DurableReceipt> {
    const staged = createDraftSyncConnectionStore({ initialConnection: connection.getState().connection, persist: () => {} });
    const actions = staged.getState();
    switch (command[0]) {
      case 'connection.startConnection': { const [, ...args] = command; actions.startConnection(...args); return changeConnection(staged.getState().connection); }
      case 'connection.confirmDraftPosition': { const [, ...args] = command; actions.confirmDraftPosition(...args); return changeConnection(staged.getState().connection); }
      case 'connection.restoreConnection': { const [, ...args] = command; actions.restoreConnection(...args); return changeConnection(staged.getState().connection); }
      case 'connection.setPrimaryLeagueSettings': { const [, ...args] = command; actions.setPrimaryLeagueSettings(...args); return changeConnection(staged.getState().connection); }
      case 'connection.setQuickMockSettings': { const [, ...args] = command; actions.setQuickMockSettings(...args); return changeConnection(staged.getState().connection); }
      case 'connection.disconnect': { actions.disconnect(); return changeConnection(null); }
      case 'setLiveDraftSession': return { result: undefined, session: await bind(command[1]) };
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
    if (binding && (draft.getState().sessionMode === 'live' || (command[0] === 'setSessionMode' && command[1] === 'live'))) {
      const receipt = await binding.indexed.commit(...command);
      assertOpen();
      draft.setState(binding.indexed.draft.getState());
      if (receipt.session.revision > binding.publishedRevision) {
        binding.publishedRevision = receipt.session.revision;
        try { channel?.postMessage(binding.identity); } catch (error) { onError(error); }
      }
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
      releaseBinding();
      draft.dispose();
      database.close();
    },
  };
}
