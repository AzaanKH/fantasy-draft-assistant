import { createDraftStore } from '@/stores/draftStore';
import { createDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { createWorkspace } from './workspace';
import { importV1, snapshotV1Storage } from './v1-import';
import { decodeIndexedSession } from './idb-session';
import type { DraftSessionIdentity } from '@/stores/draftSessionStorage';
import type { Workspace } from './workspace';
import { openDraftDatabase, type StorageDiagnostic } from './indexed-db';
import { createIndexedWorkspace, type IndexedWorkspace } from './indexed-workspace';

let binding: { bind(identity: DraftSessionIdentity): Promise<IndexedWorkspace>; errors: StorageDiagnostic[] } | undefined;

export function createHarnessWorkspace(): Workspace {
  if (!import.meta.env.DEV || import.meta.env.VITE_PERSISTENCE_HARNESS !== 'idb') throw new Error('IndexedDB workspace is available only to the development persistence harness');
  const draft = createDraftStore({ storage: null });
  const connection = createDraftSyncConnectionStore({ initialConnection: null, persist: () => undefined });
  const errors: StorageDiagnostic[] = [];
  let active: IndexedWorkspace | undefined;
  let stop: (() => void) | undefined;
  binding = { errors, async bind(identity) {
    if (active) { stop?.(); active.dispose(); }
    const imported = importV1(snapshotV1Storage(localStorage));
    const database = await openDraftDatabase({ factory: indexedDB, decode: decodeIndexedSession, report: diagnostic => { errors.push(diagnostic); } });
    try {
      await database.importV1(imported);
      if (imported.unresolved.length) throw new Error('Unresolved v1 journals prevent a writable workspace');
    } catch (error) { database.close(); throw error; }
    active = createIndexedWorkspace({ database, identity, lifecycle: { window, document },
      channel: new BroadcastChannel('fantasy-draft-workspace-v2'), report: error => { errors.push({ phase: 'error', error }); } });
    stop = active.draft.subscribe(state => { draft.setState(state); });
    await active.refresh(); draft.setState(active.draft.getState());
    return active;
  } };
  const owner = createWorkspace({ draftStore: draft, connectionStore: connection, durable: command => {
    if (!active) return Promise.reject(new Error('Bind the harness session before a durable command'));
    if (command[0] === 'connection.startConnection' || command[0] === 'connection.confirmDraftPosition' || command[0] === 'connection.restoreConnection' || command[0] === 'connection.setPrimaryLeagueSettings' || command[0] === 'connection.setQuickMockSettings' || command[0] === 'connection.disconnect') return Promise.reject(new Error('Connection commands are unavailable'));
    return active.commit(...command);
  } });
  return { ...owner, dispose() { stop?.(); active?.dispose(); binding = undefined; owner.dispose(); } };
}

export function getHarnessBinding(): NonNullable<typeof binding> {
  if (!binding) throw new Error('The mounted browser workspace is not the IndexedDB harness');
  return binding;
}
