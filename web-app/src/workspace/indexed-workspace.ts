import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DraftState } from '@/stores/draft/types';
import type { DraftSessionIdentity, PersistedDraftSession } from '@/stores/draftSessionStorage';
import type { DraftDatabase } from './indexed-db';
import { initialDraftState, reduceDraftCommand, sessionFromState, stateFromSession, type DraftCommand } from './draft-reducer';

export interface IndexedWorkspace {
  readonly draft: Pick<StoreApi<DraftState>, 'getState' | 'getInitialState' | 'subscribe'>;
  refresh(): Promise<void>;
  readPersisted(): Promise<PersistedDraftSession | null>;
  send(...command: DraftCommand): Promise<unknown>;
  commit(...command: DraftCommand): Promise<{ session: PersistedDraftSession; result: unknown }>;
  dispose(): void;
}

export function createIndexedWorkspace({ database, identity, lifecycle, channel, report, initialState, closeDatabase = true }: {
  database: DraftDatabase;
  identity: DraftSessionIdentity;
  lifecycle?: { window: Pick<Window, 'addEventListener' | 'removeEventListener'>; document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> };
  channel?: Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'removeEventListener' | 'close'>;
  report: (error: unknown) => void;
  initialState?: DraftState;
  closeDatabase?: boolean;
}): IndexedWorkspace {
  const draft = createStore(() => initialState ?? initialDraftState(identity));
  let disposed = false;
  let revision = -1;
  let localEpoch = 0;
  const localFields = (state: DraftState) => ({ filter: state.filter, mockSettings: state.mockSettings, mockAutoAdvance: state.mockAutoAdvance, mockSurvivalProbabilities: state.mockSurvivalProbabilities });
  function adopt(session: Awaited<ReturnType<DraftDatabase['read']>>): void {
    if (disposed || !session || session.revision < revision) return;
    if (session.revision === revision) {
      if ((session.lastConfirmedSyncAt ?? -1) > (draft.getState().lastConfirmedSyncAt ?? -1)) draft.setState({ lastConfirmedSyncAt: session.lastConfirmedSyncAt });
      return;
    }
    revision = session.revision; draft.setState({ ...stateFromSession(session), ...localFields(draft.getState()) }, true);
  }
  async function refresh(): Promise<void> { if (!disposed) adopt(await database.read(identity)); }
  const reread = (): void => { void refresh().catch(report); };
  const visible = (): void => { if (lifecycle?.document.visibilityState === 'visible') reread(); };
  lifecycle?.window.addEventListener('focus', reread);
  lifecycle?.document.addEventListener('visibilitychange', visible);
  channel?.addEventListener('message', reread);
  return {
    draft: { getState: draft.getState, getInitialState: draft.getInitialState, subscribe: draft.subscribe },
    refresh,
    readPersisted: () => database.read(identity),
    async send(...command: DraftCommand): Promise<unknown> { return (await this.commit(...command)).result; },
    async commit(...command: DraftCommand): Promise<{ session: PersistedDraftSession; result: unknown }> {
      if (disposed) throw new Error('Workspace is disposed');
      if (command[0] === 'setSessionMode' && command[1] !== 'live') throw new Error('Open a separate workspace for a different session mode');
      if (command[0] === 'setSearchQuery' || command[0] === 'setPositionFilter' || command[0] === 'setMockSettings' ||
          command[0] === 'setMockAutoAdvancePaused' || command[0] === 'setMockSettingsOpen' || command[0] === 'setMockSurvivalProbabilities') {
        const reduced = reduceDraftCommand(draft.getState(), command);
        ++localEpoch;
        draft.setState(reduced.state, true);
        return { session: await database.read(identity) ?? sessionFromState(draft.getState(), identity, 0), result: reduced.result };
      }
      const epoch = localEpoch;
      let changed = false;
      let reducedLocal: ReturnType<typeof localFields> | undefined;
      const committed = await database.update(identity, latest => {
        if (disposed) throw new Error('Workspace is disposed');
        const state = { ...(latest ? stateFromSession(latest) : initialState ?? initialDraftState(identity)), ...localFields(draft.getState()) };
        const reduced = reduceDraftCommand(state, command);
        reducedLocal = localFields(reduced.state);
        const candidate = sessionFromState(reduced.state, identity, latest?.revision ?? 0, latest?.lineage);
        const previous = latest ? sessionFromState(stateFromSession(latest), identity, latest.revision, latest.lineage) : null;
        // Freshness survives reload independently of the history revision.
        const historyCandidate = command[0] === 'advanceSyncFreshness' || command[0] === 'reconcileSyncedPicks'
          ? { ...candidate, lastConfirmedSyncAt: previous?.lastConfirmedSyncAt ?? null } : candidate;
        changed = JSON.stringify(historyCandidate) !== JSON.stringify(previous);
        return { session: changed ? { ...candidate, revision: candidate.revision + 1 } : candidate, result: reduced.result };
      });
      adopt(committed.session);
      if (!disposed && epoch === localEpoch && reducedLocal) draft.setState(reducedLocal);
      if (changed && !disposed) {
        try { channel?.postMessage({ provider: identity.provider, draftId: identity.draftId }); } catch (error) { report(error); }
      }
      return committed;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      lifecycle?.window.removeEventListener('focus', reread);
      lifecycle?.document.removeEventListener('visibilitychange', visible);
      channel?.removeEventListener('message', reread); channel?.close();
      if (closeDatabase) database.close();
    },
  };
}
