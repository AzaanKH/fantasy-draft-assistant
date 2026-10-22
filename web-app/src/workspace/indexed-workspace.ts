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

export function createIndexedWorkspace({ database, identity, lifecycle, channel, report }: {
  database: DraftDatabase;
  identity: DraftSessionIdentity;
  lifecycle?: { window: Pick<Window, 'addEventListener' | 'removeEventListener'>; document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> };
  channel?: Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'removeEventListener' | 'close'>;
  report: (error: unknown) => void;
}): IndexedWorkspace {
  const draft = createStore(() => initialDraftState(identity));
  let disposed = false;
  let revision = -1;
  function adopt(session: Awaited<ReturnType<DraftDatabase['read']>>): void {
    if (disposed || !session || session.revision < revision) return;
    revision = session.revision; draft.setState(stateFromSession(session), true);
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
      const committed = await database.update(identity, latest => {
        const reduced = reduceDraftCommand(latest ? stateFromSession(latest) : initialDraftState(identity), command);
        return { session: sessionFromState(reduced.state, identity, (latest?.revision ?? 0) + 1, latest?.lineage), result: reduced.result };
      });
      adopt(committed.session);
      try { channel?.postMessage({ provider: identity.provider, draftId: identity.draftId }); } catch (error) { report(error); }
      return committed;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      lifecycle?.window.removeEventListener('focus', reread);
      lifecycle?.document.removeEventListener('visibilitychange', visible);
      channel?.removeEventListener('message', reread); channel?.close(); database.close();
    },
  };
}
