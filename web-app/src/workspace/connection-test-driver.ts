import { createDraftStore } from '@/stores/draftStore';
import { createWorkspace } from './workspace';
import { resolveInitialConnection, type PersistedDraftSyncConnection } from './connection-hints';
import type { ConnectionActions, ConnectionQuery } from './connection';

interface ConnectionTestDriver { getState(): ConnectionActions & ConnectionQuery; dispose(): void }

export function createConnectionTestDriver({ initialConnection, persist }: {
  initialConnection: PersistedDraftSyncConnection | null;
  persist: (connection: PersistedDraftSyncConnection | null) => void;
}): ConnectionTestDriver {
  const workspace = createWorkspace({ draftStore: createDraftStore(), initialConnection, persist });
  const actions: ConnectionActions = {
    applyProviderSettings: (...args) => { workspace.send('connection.applyProviderSettings', ...args); },
    startConnection: (...args) => { workspace.send('connection.startConnection', ...args); },
    confirmDraftPosition: (...args) => { workspace.send('connection.confirmDraftPosition', ...args); },
    restoreConnection: (...args) => { workspace.send('connection.restoreConnection', ...args); },
    applyHint: (...args) => { workspace.send('connection.applyHint', ...args); },
    setPrimaryLeagueSettings: (...args) => { workspace.send('connection.setPrimaryLeagueSettings', ...args); },
    setQuickMockSettings: (...args) => { workspace.send('connection.setQuickMockSettings', ...args); },
    disconnect: () => { workspace.send('connection.disconnect'); },
  };
  return { getState: () => ({ ...actions, ...workspace.connection.getState() }), dispose: workspace.dispose };
}
export function initializeConnectionTestDriver(driver: ReturnType<typeof createConnectionTestDriver>, search: string): void {
  const hint = resolveInitialConnection(search, driver.getState().connection);
  if (hint) driver.getState().applyHint(hint);
}
