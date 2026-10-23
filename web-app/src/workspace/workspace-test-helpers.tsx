import { createElement, type ReactElement, type ReactNode } from 'react';
import type { DraftStoreApi } from '@/stores/draftStore';
import { createDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { createWorkspace, type Workspace } from './workspace';
import { WorkspaceProvider } from './WorkspaceProvider';

const workspaces = new WeakMap<DraftStoreApi, Workspace>();

export function workspaceForTestStore(store: DraftStoreApi): Workspace {
  let workspace = workspaces.get(store);
  if (!workspace) {
    const session = store.getState().liveSession;
    workspace = createWorkspace({ draftStore: store, connectionStore: createDraftSyncConnectionStore({
      initialConnection: session ? { ...session, draftPosition: null } : null,
      persist: () => undefined,
    }) });
    workspaces.set(store, workspace);
  }
  return workspace;
}

export function WorkspaceTestProvider({ store, children }: {
  readonly store: DraftStoreApi;
  readonly children: ReactNode;
}): ReactElement {
  return createElement(WorkspaceProvider, { workspace: workspaceForTestStore(store), children });
}
