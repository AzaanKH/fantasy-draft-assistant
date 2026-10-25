import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { rollbackFacts, digestRollbackFacts, digestRollbackJournals } from '../../web-app/src/workspace/rollback-export.ts';

const [checkout, input, output, revision, mode, fencing] = process.argv.slice(2);
const exported = JSON.parse(await readFile(input, 'utf8'));
const { createDraftStore } = await import(pathToFileURL(`${checkout}/web-app/src/stores/draftStore.ts`).href);
const { parseStoredDraftSession } = await import(pathToFileURL(`${checkout}/web-app/src/stores/draftSessionStorage.ts`).href);
const { readDraftSessionChanges, writeDraftSessionChange } = await import(pathToFileURL(`${checkout}/web-app/src/stores/draftSessionUnconfirmedSaves.ts`).href);
const values = new Map(exported.writes.map(({ key, serialized }) => [key, serialized]));
const storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
const sessions = exported.sessions.map(row => JSON.parse(row.serialized));
const loaded = sessions.map(session => parseStoredDraftSession(storage.getItem(`fantasy-draft-session-v1:${session.identity.provider}:${session.identity.draftId}`), session.identity));
assert.equal(await digestRollbackFacts(rollbackFacts(loaded)), exported.expectedFactsDigest);
const journals = sessions.flatMap(session => readDraftSessionChanges(storage, session.identity)).sort((a, b) => a.key.localeCompare(b.key));
assert.deepEqual(journals.map(({ key, serialized }) => ({ key, serialized })), exported.journals.map(({ key, serialized }) => ({ key, serialized })));
assert.equal(await digestRollbackJournals(journals), exported.expectedJournalsDigest);
for (const journal of journals) {
  const [, provider, draftId, tab] = /^fantasy-draft-session-unconfirmed-v1:([^:]+):([^:]+):(.+)$/.exec(journal.key);
  writeDraftSessionChange(storage, { provider, draftId }, tab, journal.change);
}
assert.equal(await digestRollbackJournals(sessions.flatMap(session => readDraftSessionChanges(storage, session.identity)).sort((a, b) => a.key.localeCompare(b.key))), exported.expectedJournalsDigest);
const stores = sessions.map(session => createDraftStore({ storage, session: session.identity }));
try {
  assert.equal(await digestRollbackFacts(rollbackFacts(sessions.map(session => parseStoredDraftSession(storage.getItem(`fantasy-draft-session-v1:${session.identity.provider}:${session.identity.draftId}`), session.identity)))), exported.expectedFactsDigest);
  const store = stores[0];
  store.getState().setSessionMode('live');
  store.getState().togglePlayerShortlisted('old-write-compatible');
  assert(store.getState().shortlistedPlayerIds.includes('old-write-compatible'));
  const marker = JSON.stringify({ version: 1, migratedAt: 1770000000000, by: 'flip-proof' });
  storage.setItem('fantasy-draft-storage-migrated', marker);
  const before = [...values];
  store.getState().togglePlayerShortlisted('old-after-tombstone');
  const frozen = !store.getState().shortlistedPlayerIds.includes('old-after-tombstone');
  assert.equal(frozen, fencing === 'fenced');
  if (frozen) assert.deepEqual([...values], before);
  else assert.notDeepEqual([...values], before);
  await writeFile(output, JSON.stringify({ revision, mode, exportDigest: exported.digest, loadAndWriteCompatible: true,
    journalsCompatible: true, frozen, bytesPreservedWhenFenced: frozen, preTombstoneResidualRisk: !frozen }, null, 2), { flag: 'wx' });
} finally { for (const store of stores) store.dispose?.(); }
