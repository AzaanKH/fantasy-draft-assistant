import { createDraftStore } from '@/stores/draftStore';
import { createDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import type { VerifiedStorageSharing } from './storage-sharing';
import { createWorkspace } from './workspace';
import { captureV1ImportSnapshot, importV1Snapshot } from './import-snapshot';
import { decodeIndexedSession } from './idb-session';
import type { DraftSessionIdentity } from '@/stores/draftSessionStorage';
import type { Workspace } from './workspace';
import { openDraftDatabase, type StorageDiagnostic } from './indexed-db';
import { createIndexedWorkspace, type IndexedWorkspace } from './indexed-workspace';

let binding: { bind(identity: DraftSessionIdentity): Promise<IndexedWorkspace>; errors: StorageDiagnostic[] } | undefined;

export function createHarnessWorkspace(verified: VerifiedStorageSharing): Workspace {
  if (verified.origin !== window.location.origin) throw new Error('Storage verification belongs to another origin');
  if (!import.meta.env.DEV || import.meta.env.VITE_PERSISTENCE_HARNESS !== 'idb') throw new Error('IndexedDB workspace is available only to the development persistence harness');
  const draft = createDraftStore({ storage: null });
  const connection = createDraftSyncConnectionStore({ initialConnection: null, persist: () => undefined });
  const errors: StorageDiagnostic[] = [];
  let active: IndexedWorkspace | undefined;
  let stop: (() => void) | undefined;
  binding = { errors, async bind(identity) {
    stop?.(); active?.dispose(); stop = undefined; active = undefined;
    let database: Awaited<ReturnType<typeof openDraftDatabase>> | undefined;
    let candidate: IndexedWorkspace | undefined;
    try {
      const snapshot = captureV1ImportSnapshot(localStorage);
      database = await openDraftDatabase({ factory: indexedDB, decode: decodeIndexedSession, report: diagnostic => { errors.push(diagnostic); } });
      await importV1Snapshot({ database, snapshot, identity, report: diagnostic => { errors.push(diagnostic); } });
      candidate = createIndexedWorkspace({ database, identity, lifecycle: { window, document },
        channel: new BroadcastChannel('fantasy-draft-workspace-v2'), report: error => { errors.push({ phase: 'error', error }); } });
      await candidate.refresh();
      snapshot.verifySource();
      draft.setState(candidate.draft.getState());
      stop = candidate.draft.subscribe(state => { draft.setState(state); });
      active = candidate;
      return active;
    } catch (error) {
      candidate?.dispose(); database?.close();
      if (!errors.some(diagnostic => diagnostic.error === error)) errors.push({ phase: 'error', error });
      throw error;
    }
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
