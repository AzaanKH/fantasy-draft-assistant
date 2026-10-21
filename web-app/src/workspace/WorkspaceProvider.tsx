import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { DraftState, DraftSessionMode } from '@/stores/draft/types';
import type { DraftSyncConnectionStore } from '@/stores/draftSyncStore';
import type { Workspace } from './workspace';

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ workspace, children }: {
  readonly workspace: Workspace;
  readonly children: ReactNode;
}): ReactElement {
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return workspace;
}

export function useDraftState<T>(selector: (state: DraftState) => T): T {
  return useStore(useWorkspace().draft, selector);
}

export function useConnectionState<T>(selector: (state: Pick<DraftSyncConnectionStore, 'connection'>) => T): T {
  return useStore(useWorkspace().connection, selector);
}

export const useDraftSessionMode = (): DraftSessionMode => useDraftState(state => state.sessionMode);
