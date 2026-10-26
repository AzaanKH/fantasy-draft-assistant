import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { openDraftDatabase } from '../../web-app/src/workspace/indexed-db.ts';
import { decodeIndexedSession } from '../../web-app/src/workspace/idb-session.ts';
import { prepareRollback, writeRollbackExport } from '../../web-app/src/workspace/rollback-export.ts';

const { IDBFactory } = createRequire(new URL('../../web-app/package.json', import.meta.url))('fake-indexeddb');
const [input, output] = process.argv.slice(2);
const captured = JSON.parse(await readFile(input, 'utf8'));
const values = new Map(captured.entries);
const storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: error => { throw error; } });
try {
  await database.commit({ expect: {}, sessions: captured.sessions.map(({ key, value }) => ({ key, session: decodeIndexedSession(value) })), metadata: captured.metadata });
  let exported = await prepareRollback(database, { storage });
  const decisions = exported.reconciliation.blockers.map(row => ({ blockerId: row.id, digest: row.digest, action: 'keep-indexed' }));
  exported = await prepareRollback(database, { storage, decisions });
  assert.deepEqual(exported.reconciliation.pending, []);
  await writeRollbackExport({ database, storage, export: exported });
  assert.deepEqual(exported.writes.map(({ key, serialized }) => [key, storage.getItem(key)]), exported.writes.map(({ key, serialized }) => [key, serialized]));
  await writeFile(output, JSON.stringify(exported, null, 2), { flag: 'wx' });
} finally { database.close(); }
