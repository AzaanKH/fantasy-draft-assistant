import { createDraftStore, subscribeToBrowserStorageEvents } from '@/stores/draftStore';
import { getBrowserDraftSessionStorage } from '@/stores/draftSessionStorage';
import { createDraftSyncConnectionStore, initializeDraftSyncConnection, persistConnection, readStoredConnection } from '@/stores/draftSyncStore';
import { createWorkspace, type Workspace } from './workspace';

let browserWorkspace: Workspace | undefined;

export function createBrowserWorkspace(search: string, harnessFactory?: () => Workspace): Workspace {
  if (browserWorkspace) throw new Error('The browser composition root already has a workspace');
  if (harnessFactory) {
    browserWorkspace = harnessFactory();
    return browserWorkspace;
  }
  const connectionStore = createDraftSyncConnectionStore({ initialConnection: readStoredConnection(), persist: persistConnection });
  initializeDraftSyncConnection(connectionStore, search);
  const workspace = createWorkspace({
    draftStore: createDraftStore({ storage: getBrowserDraftSessionStorage(), externalChanges: subscribeToBrowserStorageEvents }),
    connectionStore,
  });
  const mountedWorkspace: Workspace = { ...workspace, dispose: () => {
    workspace.dispose();
    if (browserWorkspace === mountedWorkspace) browserWorkspace = undefined;
  } };
  browserWorkspace = mountedWorkspace;
  return mountedWorkspace;
}

export function getBrowserWorkspace(): Workspace {
  if (!browserWorkspace) throw new Error('The browser composition root has not created its workspace');
  return browserWorkspace;
}
