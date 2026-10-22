import { DRAFT_STORAGE_MIGRATION_KEY, isDraftStorageMigration } from '@fantasy-draft/shared';
import { toast } from 'sonner';
import type { DraftSessionStorage } from './draftSessionStorage';

const RELOAD_MESSAGE = 'Draft storage has migrated. Reload to continue.';
const warned = new WeakMap<DraftSessionStorage, string>();
const failedReads = new WeakSet<DraftSessionStorage>();

export class DraftStorageMigratedError extends Error {
  constructor() { super(RELOAD_MESSAGE); }
}

export function isDraftStorageMigrated(storage: DraftSessionStorage | null): boolean {
  if (!storage) return false;
  let serialized: string;
  try {
    const value = storage.getItem(DRAFT_STORAGE_MIGRATION_KEY);
    if (value === null) return false;
    serialized = value;
  } catch (error) {
    if (!failedReads.has(storage)) {
      failedReads.add(storage);
      console.warn('[Fantasy Draft] Unable to read migration tombstone; retaining the legacy storage fallback.', { error });
    }
    return false;
  }
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isDraftStorageMigration(value)) throw new Error('Invalid version 1 migration tombstone');
  } catch (error) {
    if (warned.get(storage) !== serialized) {
      warned.set(storage, serialized);
      console.warn('[Fantasy Draft] Malformed migration tombstone; v1 writes are blocked.', { error });
    }
  }
  return true;
}

export function assertDraftStorageWritable(storage: DraftSessionStorage): void {
  if (isDraftStorageMigrated(storage)) throw new DraftStorageMigratedError();
}

export function showDraftStorageReloadNotice(): void {
  toast.error(RELOAD_MESSAGE, {
    id: 'draft-storage-migrated',
    duration: Infinity,
    action: { label: 'Reload app', onClick: () => { window.location.reload(); } },
  });
}
