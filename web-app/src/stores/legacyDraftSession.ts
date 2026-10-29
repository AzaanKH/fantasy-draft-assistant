function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Brings a version 1 session saved by an older release to the current shape:
 * sessions predating draft types used snake order, sessions predating multi-tab
 * merging have no revision or lineage, and sessions predating draft progress
 * carry their saved cursor. Values already in the current shape pass unchanged.
 */
export function migrateLegacyDraftSession(value: Record<string, unknown>): Record<string, unknown> {
  const migrated: Record<string, unknown> = { revision: 0, lineage: [], ...value };
  if (isRecord(value.config) && !('draftType' in value.config)) {
    migrated.config = { ...value.config, draftType: 'snake' };
  }
  if (!('draftProgress' in value) && Array.isArray(value.draftHistory)) {
    migrated.draftProgress = { anchor: { kind: 'carry', pickNumber: value.currentPick }, historyLength: value.draftHistory.length };
  }
  return migrated;
}

/** Parses saved session text and migrates it, leaving anything other than an object for the decoder to reject. */
export function readLegacyDraftSession(serialized: string): unknown {
  const value: unknown = JSON.parse(serialized);
  return isRecord(value) ? migrateLegacyDraftSession(value) : value;
}
