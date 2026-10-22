import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { rollbackFacts, digestRollbackFacts, digestRollbackJournals } from '../../web-app/src/workspace/rollback-export';

const [checkout, input, output, revision] = process.argv.slice(2);
if (!checkout || !input || !output || !revision) throw new Error('Pass old checkout, rollback export, output and pinned revision');
const exported = JSON.parse(readFileSync(input, 'utf8'));
const sessions = exported.sessions.map((row: { serialized: string }) => JSON.parse(row.serialized));
const oldStorage = `${checkout}/web-app/src/stores/draftSessionStorage.ts`;
const { parseStoredDraftSession } = await import(pathToFileURL(oldStorage).href);
const { readDraftSessionChanges } = await import(pathToFileURL(`${checkout}/web-app/src/stores/draftSessionUnconfirmedSaves.ts`).href);
const { createDraftStore } = await import(pathToFileURL(`${checkout}/web-app/src/stores/draftStore.ts`).href);
const values = new Map<string, string>(exported.writes.map((row: { key: string; serialized: string }) => [row.key, row.serialized]));
const storage = {
  get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
};
function journals(heads) {
  const decoded = heads.flatMap(head => readDraftSessionChanges(storage, head.identity));
  const rawKeys = [...values.keys()].filter(key => key.startsWith('fantasy-draft-session-unconfirmed-v1:')).sort();
  const unaccounted = rawKeys.flatMap(key => {
    const row = decoded.find(row => row.key === key);
    if (!row) return [{ key, serialized: values.get(key) }];
    const head = heads.find(head => key.startsWith(`fantasy-draft-session-unconfirmed-v1:${head.identity.provider}:${head.identity.draftId}:`));
    return head?.lineage?.includes(row.change.writeId) ? [] : [row];
  });
  return { rawKeys, decoded, unaccounted };
}
const loaded = sessions.map((session: { identity: { provider: string; draftId: string } }) => {
  const key = `fantasy-draft-session-v1:${session.identity.provider}:${session.identity.draftId}`;
  const parsed = parseStoredDraftSession(storage.getItem(key), session.identity);
  assert.ok(parsed, `Real old reader rejected ${key}`);
  return parsed;
});
const loadDigest = await digestRollbackFacts(rollbackFacts(loaded));
assert.equal(loadDigest, exported.expectedFactsDigest, 'Real old reader lost exported facts');
const loadJournals = journals(loaded);
const loadJournalsDigest = await digestRollbackJournals(loadJournals.unaccounted);
assert.equal(loadJournalsDigest, exported.expectedJournalsDigest, 'Real old reader has unaccounted retained journals');
const written = sessions.map((session: { identity: { provider: string; draftId: string } }) => {
  const store = createDraftStore({ storage, session: session.identity });
  const actions = store.getState();
  actions.setSessionMode('live');
  const sentinel = '__rollback_writeback_check__';
  assert.ok(!actions.shortlistedPlayerIds.includes(sentinel));
  actions.togglePlayerShortlisted(sentinel); actions.togglePlayerShortlisted(sentinel);
  const key = `fantasy-draft-session-v1:${session.identity.provider}:${session.identity.draftId}`;
  const parsed = parseStoredDraftSession(storage.getItem(key), session.identity);
  assert.ok(parsed, `Real old writer erased ${key}`);
  store.dispose?.();
  return parsed;
});
const writeDigest = await digestRollbackFacts(rollbackFacts(written));
assert.equal(writeDigest, exported.expectedFactsDigest, 'Real old writer lost exported facts');
const writeJournals = journals(written);
const writeJournalsDigest = await digestRollbackJournals(writeJournals.unaccounted);
assert.equal(writeJournalsDigest, exported.expectedJournalsDigest, 'Real old writer has unaccounted retained journals');
const modules = ['draftSessionStorage.ts', 'draftSessionUnconfirmedSaves.ts', 'draftStore.ts'];
const hash = createHash('sha256');
for (const name of modules) hash.update(readFileSync(`${checkout}/web-app/src/stores/${name}`));
const moduleDigest = hash.digest('hex');
writeFileSync(output, JSON.stringify({ revision, moduleDigest, load: loadDigest, writeback: writeDigest, loadJournalsDigest, writeJournalsDigest, loadJournals, writeJournals, loaded: rollbackFacts(loaded), written: rollbackFacts(written) }, null, 2));
