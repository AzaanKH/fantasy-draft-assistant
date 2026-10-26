import { createDraftStore, subscribeToBrowserStorageEvents } from '@/stores/draftStore';
import { getBrowserDraftSessionStorage } from '@/stores/draftSessionStorage';
import { resolveInitialConnection, persistConnection, readStoredConnection } from './connection-hints';
import { createWorkspace, type Workspace } from './workspace';

let browserWorkspace: Workspace | undefined;

export function createBrowserWorkspace(search: string, harnessFactory?: () => Workspace): Workspace {
  if (browserWorkspace) throw new Error('The browser composition root already has a workspace');
  if (harnessFactory) {
    browserWorkspace = harnessFactory();
    return browserWorkspace;
  }
  const initialConnection = resolveInitialConnection(search, readStoredConnection());
  const workspace = createWorkspace({
    draftStore: createDraftStore({ storage: getBrowserDraftSessionStorage(), externalChanges: subscribeToBrowserStorageEvents }),
    initialConnection, persist: persistConnection,
  });
  if (workspace.connection.getState().connection?.draftPosition != null) workspace.send('setSessionMode', 'live');
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
