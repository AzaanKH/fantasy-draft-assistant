import type { DraftSessionIdentity } from '@/stores/draftSessionStorage';
import type { DraftDatabase, StorageDiagnostic } from './indexed-db';
import { importV1, snapshotV1Storage, type RawV1Entry, type V1Import } from './v1-import';

type StorageReader = Parameters<typeof snapshotV1Storage>[0];
type RefusedImports = Awaited<ReturnType<DraftDatabase['importV1']>>['refused'];

export interface V1ImportSnapshot {
  readonly imported: V1Import;
  readonly verifySource: () => void;
}

export class V1SourceChangedError extends Error {
  constructor(readonly captured: readonly RawV1Entry[], readonly current: readonly RawV1Entry[]) {
    super('The v1 import source changed. Retry after closing other draft windows.');
    this.name = 'V1SourceChangedError';
  }
}

export class V1ImportDiagnostic extends Error {
  constructor(readonly imported: V1Import, readonly refused: RefusedImports) {
    super(`V1 import retained ${imported.rejected.length} rejected entries and ${imported.unresolved.length} unresolved journals. Refused sources: ${refused.map(row => `${row.identity.provider}:${row.identity.draftId} (${row.reason})`).join(', ') || 'none'}`);
    this.name = 'V1ImportDiagnostic';
  }
}

export function captureV1ImportSnapshot(storage: StorageReader): V1ImportSnapshot {
  const source = snapshotV1Storage(storage);
  const captured = new Map(source.map(entry => [entry.key, entry.serialized]));
  return {
    imported: importV1(source),
    verifySource() {
      const current = snapshotV1Storage(storage);
      if (current.length !== captured.size || current.some(entry => captured.get(entry.key) !== entry.serialized)) {
        throw new V1SourceChangedError(source, current);
      }
    },
  };
}

export async function importV1Snapshot({ database, snapshot, identity, report }: {
  database: Pick<DraftDatabase, 'importV1'>;
  snapshot: V1ImportSnapshot;
  identity: DraftSessionIdentity;
  report: (diagnostic: StorageDiagnostic) => void;
}): Promise<void> {
  const { imported, verifySource } = snapshot;
  const { refused } = await database.importV1(imported, { verifySource });
  const diagnostic = new V1ImportDiagnostic(imported, refused);
  if (imported.rejected.length || imported.unresolved.length || refused.length) report({ phase: 'error', error: diagnostic });
  verifySource();
  const headKey = `fantasy-draft-session-v1:${identity.provider}:${identity.draftId}`;
  const rejectedHead = imported.source.some(entry => entry.key === headKey) &&
    !imported.sessions.some(session => session.identity.provider === identity.provider && session.identity.draftId === identity.draftId);
  const journalPrefix = `fantasy-draft-session-unconfirmed-v1:${identity.provider}:${identity.draftId}:`;
  if (rejectedHead || imported.unresolved.some(journal => journal.key.startsWith(journalPrefix)) ||
      refused.some(row => row.identity.provider === identity.provider && row.identity.draftId === identity.draftId)) {
    throw diagnostic;
  }
}
