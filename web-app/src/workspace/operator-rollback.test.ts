// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createActivationStorage } from './activation-storage';
import { installRollbackOperator } from './operator-rollback';
import { ROLLBACK_READERS, type RollbackExport, type RollbackVerification } from './rollback-export';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.draftStorageOperator; });
function syntheticVerification(value: RollbackExport): RollbackVerification {
  return { exportDigest: value.digest, verifiedAt: 100, verifiedBy: 'unit-test-synthetic', readers: ROLLBACK_READERS.flatMap(reader =>
    (['load', 'writeback'] as const).map(phase => ({ commit: reader.commit, phase, moduleDigest: 'a'.repeat(64), factsDigest: value.expectedFactsDigest, journalsDigest: value.expectedJournalsDigest }))) };
}
it('recovers the exact prepared export after the operator entry is reinstalled', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} });
  const controller = createActivationStorage({ storage: localStorage, factory: indexedDB, report: () => undefined });
  await controller.preflight(); const database = await controller.activate([], { otherTabsClosed: true }); database.close();
  installRollbackOperator();
  const exported = await window.draftStorageOperator?.prepare({ otherTabsClosed: true });
  if (!exported) throw new Error('Missing export');
  expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
  installRollbackOperator();
  await window.draftStorageOperator?.finalize(syntheticVerification(exported), { otherTabsClosed: true, operator: 'test-operator' });
  expect(localStorage.getItem('fantasy-draft-storage-migrated')).toBeNull();
});
