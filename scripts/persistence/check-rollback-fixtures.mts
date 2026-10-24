import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Processes } from '@fantasy-draft/shared/node';
import { createActivationStorage } from '../../web-app/src/workspace/activation-storage';
import { prepareRollback, recoverRollbackExport, writeRollbackExport, finalizeRollback, type RollbackVerification } from '../../web-app/src/workspace/rollback-export';
import { ROLLBACK_METADATA } from '../../web-app/src/workspace/rollback-export';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [fixtures, output] = process.argv.slice(2);
if (!fixtures || !output) throw new Error('Pass pinned old-module fixtures directory and a fresh output directory');
await mkdir(output, { recursive: false });
const { IDBFactory } = createRequire(path.join(root, 'web-app/package.json'))('fake-indexeddb');
const results = [];
for (const name of ['main', 'stack']) {
  const fixture = JSON.parse(await readFile(path.join(fixtures, `${name}-bytes.json`), 'utf8'));
  const values = new Map<string, string>(fixture.complete);
  let interruptKey: string | undefined;
  const storage = {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (key === interruptKey) throw new Error('interrupted journal write'); values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => { values.clear(); },
  };
  const controller = createActivationStorage({ storage, factory: new IDBFactory(), report: () => undefined });
  try {
    const review = await controller.preflight(); assert.equal(review.status, 'review');
    if (review.status !== 'review') throw new Error('Fixture activation unavailable');
    const decisions = review.blockers.map(blocker => ({ blockerId: blocker.id, digest: blocker.digest,
      action: blocker.actions.includes('keep-imported') ? 'keep-imported' as const : 'discard-entry' as const }));
    const database = await controller.activate(decisions, { otherTabsClosed: true });
    try {
      const original: [string, string] | undefined = fixture.retained.find(([key]: [string, string]) => key.startsWith('fantasy-draft-session-unconfirmed-v1:'));
      assert.ok(original);
      const source = { key: original[0], serialized: original[1] };
      const variant = JSON.parse(source.serialized); variant.writeId = 'fixture-orphan'; variant.baseWriteId = 'fixture-missing-base';
      variant.picks = variant.picks.map(row => ({ ...row, after: row.after ? { ...row.after, playerId: 'fixture-retained-only' } : null }));
      const orphan = { key: source.key, serialized: ` \n${JSON.stringify(variant)}\t` };
      await database.commit({ expect: {}, metadata: [{ key: 'retained-same-key-journals', value: [source, orphan] },
        { key: `${ROLLBACK_METADATA}:historical-fixture`, value: { retained: [{ source: [orphan] }] } }] });
      const initial = await prepareRollback(database, { storage });
      const exported = await prepareRollback(database, { storage, decisions: initial.reconciliation.blockers.map(row =>
        ({ blockerId: row.id, digest: row.digest, action: 'keep-indexed' as const })) });
      assert.equal(exported.reconciliation.pending.length, 0);
      assert.ok(exported.journals.length >= 2);
      assert.ok(exported.journals.some(row => row.serialized === orphan.serialized));
      interruptKey = exported.journals.at(-1)?.key;
      await assert.rejects(writeRollbackExport({ database, storage, export: exported }), /interrupted journal write/);
      interruptKey = undefined;
      const recovered = await recoverRollbackExport(database); assert.deepEqual(recovered, exported);
      assert.ok(recovered);
      await writeRollbackExport({ database, storage, export: recovered });
      const input = path.join(output, `${name}-export.json`); const proofPath = path.join(output, `${name}-verification.json`);
      await writeFile(input, JSON.stringify(recovered, null, 2));
      const proofRun = await Processes.run('node', ['scripts/persistence/verify-rollback.mjs', input, proofPath], { cwd: root, timeoutMs: 120000, maxOutputBytes: 1000000 }).catch(async error => {
        await writeFile(path.join(output, `${name}-proof-failed.log`), (error.result?.stdout ?? '') + (error.result?.stderr ?? '') + String(error));
        throw error;
      });
      await writeFile(path.join(output, `${name}-proof.log`), proofRun.stdout + proofRun.stderr);
      const proof: RollbackVerification = JSON.parse(await readFile(proofPath, 'utf8'));
      await finalizeRollback({ database, storage, export: recovered, verification: proof, confirmation: { otherTabsClosed: true, operator: 'check-rollback-fixtures.mts' } });
      assert.equal(storage.getItem('fantasy-draft-storage-migrated'), null);
      for (const row of exported.writes) assert.equal(storage.getItem(row.key), row.serialized);
      assert.ok(JSON.stringify((await database.snapshot()).metadata).includes('fixture-retained-only'));
      results.push({ name, exportDigest: exported.digest, journals: exported.journals.length, expectedJournalsDigest: exported.expectedJournalsDigest,
        actualPinnedReaderRows: proof.readers.length, interruptedRetryExact: true, retainedOriginalRecoverable: true, tombstoneRemoved: true });
    } finally { database.close(); }
  } finally { controller.close(); }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
