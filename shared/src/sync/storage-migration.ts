export const DRAFT_STORAGE_MIGRATION_KEY = 'fantasy-draft-storage-migrated';

export interface DraftStorageMigration {
  readonly version: 1;
  readonly migratedAt: number;
  readonly by: string;
}

export function isDraftStorageMigration(value: unknown): value is DraftStorageMigration {
  return typeof value === 'object' && value !== null && 'version' in value && value.version === 1 &&
    'migratedAt' in value && typeof value.migratedAt === 'number' && Number.isFinite(value.migratedAt) &&
    'by' in value && typeof value.by === 'string' && value.by.trim().length > 0;
}
