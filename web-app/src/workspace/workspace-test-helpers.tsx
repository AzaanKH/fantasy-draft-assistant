import { createElement, type ReactElement, type ReactNode } from 'react';
import type { DraftStoreApi } from '@/stores/draftStore';
import { createWorkspace, type Workspace } from './workspace';
import { WorkspaceProvider } from './WorkspaceProvider';

const workspaces = new WeakMap<DraftStoreApi, Workspace>();

export function workspaceForTestStore(store: DraftStoreApi): Workspace {
  let workspace = workspaces.get(store);
  if (!workspace) {
    const session = store.getState().liveSession;
    workspace = createWorkspace({ draftStore: store, initialConnection: session ? { ...session, draftPosition: null } : null });
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
