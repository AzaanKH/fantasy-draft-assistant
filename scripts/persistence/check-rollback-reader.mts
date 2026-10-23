import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { rollbackFacts, digestRollbackFacts, digestRollbackJournals } from '../../web-app/src/workspace/rollback-export';
import { digest } from '../../web-app/src/workspace/indexed-db';

const [checkout, input, output, revision] = process.argv.slice(2);
if (!checkout || !input || !output || !revision) throw new Error('Pass old checkout, rollback export, output and pinned revision');
const exported = JSON.parse(readFileSync(input, 'utf8'));
const { digest: exportDigest, ...body } = exported;
assert.equal(await digest(body), exportDigest, 'Export digest differs from exact supplied bytes');
const sessions = exported.sessions.map((row: { serialized: string }) => JSON.parse(row.serialized));
const { parseStoredDraftSession } = await import(pathToFileURL(`${checkout}/web-app/src/stores/draftSessionStorage.ts`).href);
const { readDraftSessionChanges, writeDraftSessionChange } = await import(pathToFileURL(`${checkout}/web-app/src/stores/draftSessionUnconfirmedSaves.ts`).href);
const { createDraftStore } = await import(pathToFileURL(`${checkout}/web-app/src/stores/draftStore.ts`).href);
const journalPrefix = 'fantasy-draft-session-unconfirmed-v1:';
type Entry = { key: string; serialized: string };
function memoryStorage(entries: Entry[]) {
  const values = new Map<string, string>(entries.map(row => [row.key, row.serialized]));
  assert.equal(values.size, entries.length, 'Export overwrites a duplicate key');
  return {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
    entries: () => [...values].map(([key, serialized]) => ({ key, serialized })),
  };
}
function identityOf(key: string) {
  const parts = key.slice(journalPrefix.length).split(':');
  assert.equal(parts.length, 3, 'Journal key must use the real v1 identity/tab format');
  assert.ok(parts[2]);
  return { provider: parts[0], draftId: parts[1] };
}
function journals(storage: ReturnType<typeof memoryStorage>) {
  const raw = storage.entries().filter(row => row.key.startsWith(journalPrefix)).sort((a, b) => a.key.localeCompare(b.key));
  const identities = new Map(raw.map(row => { const identity = identityOf(row.key); return [`${identity.provider}:${identity.draftId}`, identity]; }));
  const decoded = [...identities.values()].flatMap(identity => readDraftSessionChanges(storage, identity)).sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(decoded.map(row => ({ key: row.key, serialized: row.serialized })), raw, 'Real old journal reader rejected or skipped an exported row');
  return { rawKeys: raw.map(row => row.key), decoded };
}
function heads(storage: ReturnType<typeof memoryStorage>) {
  return sessions.map((session: { identity: { provider: string; draftId: string } }) => {
    const key = `fantasy-draft-session-v1:${session.identity.provider}:${session.identity.draftId}`;
    const parsed = parseStoredDraftSession(storage.getItem(key), session.identity);
    assert.ok(parsed, `Real old reader rejected ${key}`);
    return parsed;
  });
}
function writeHeads(storage: ReturnType<typeof memoryStorage>) {
  return sessions.map((session: { identity: { provider: string; draftId: string } }) => {
    const store = createDraftStore({ storage, session: session.identity });
    const actions = store.getState(); actions.setSessionMode('live');
    const sentinel = '__rollback_writeback_check__'; assert.ok(!actions.shortlistedPlayerIds.includes(sentinel));
    actions.togglePlayerShortlisted(sentinel); actions.togglePlayerShortlisted(sentinel);
    const key = `fantasy-draft-session-v1:${session.identity.provider}:${session.identity.draftId}`;
    const parsed = parseStoredDraftSession(storage.getItem(key), session.identity);
    assert.ok(parsed, `Real old writer erased ${key}`); store.dispose?.();
    return parsed;
  });
}
const storage = memoryStorage(exported.writes);
const loaded = heads(storage);
const loadDigest = await digestRollbackFacts(rollbackFacts(loaded));
assert.equal(loadDigest, exported.expectedFactsDigest, 'Real old reader lost exported head facts');
const loadJournals = journals(storage);
assert.deepEqual(loadJournals.decoded.map(row => ({ key: row.key, serialized: row.serialized })),
  exported.journals.map(({ key, serialized }: Entry) => ({ key, serialized })), 'Export journal manifest differs from actual bytes');
const loadJournalsDigest = await digestRollbackJournals(loadJournals.decoded);
assert.equal(loadJournalsDigest, exported.expectedJournalsDigest, 'Real old reader lost exported journal facts');
const journalStorage = memoryStorage([]);
for (const row of loadJournals.decoded) {
  const identity = identityOf(row.key);
  const tab = row.key.slice(`${journalPrefix}${identity.provider}:${identity.draftId}:`.length);
  writeDraftSessionChange(journalStorage, identity, tab, row.change);
}
const writeJournals = journals(journalStorage);
const writeJournalsDigest = await digestRollbackJournals(writeJournals.decoded);
assert.equal(writeJournalsDigest, exported.expectedJournalsDigest, 'Real old journal writer changed or omitted exported facts');
const headStorage = memoryStorage(exported.writes.filter((row: Entry) => !row.key.startsWith(journalPrefix)));
const written = writeHeads(headStorage);
const writeDigest = await digestRollbackFacts(rollbackFacts(written));
assert.equal(writeDigest, exported.expectedFactsDigest, 'Real old writer lost exported head facts');
const generated = journals(headStorage);
for (const row of generated.decoded) {
  const identity = identityOf(row.key);
  const head = written.find(head => head.identity.provider === identity.provider && head.identity.draftId === identity.draftId);
  assert.ok(head?.lineage.includes(row.change.writeId), 'Unaccounted journal from the real old session writer');
}
const ordinaryStorage = memoryStorage(exported.writes);
const ordinaryWritten = writeHeads(ordinaryStorage);
const ordinaryJournals = journals(ordinaryStorage);
const removed = loadJournals.decoded.filter(row => !ordinaryJournals.rawKeys.includes(row.key)).map(row => ({ key: row.key, change: row.change,
  reason: loaded.some(head => head.lineage.includes(row.change.writeId)) ? 'lineage-covered consumption' : 'ordinary-store recovery or unresolved deletion' }));
const modules = ['draftSessionStorage.ts', 'draftSessionUnconfirmedSaves.ts', 'draftStore.ts'];
const hash = createHash('sha256');
for (const name of modules) hash.update(readFileSync(`${checkout}/web-app/src/stores/${name}`));
const moduleDigest = hash.digest('hex');
writeFileSync(output, JSON.stringify({ revision, exportDigest, moduleDigest, load: loadDigest, writeback: writeDigest,
  loadJournalsDigest, writeJournalsDigest, loadJournalBytesDigest: await digest(loadJournals.decoded.map(({ key, serialized }: Entry) => ({ key, serialized }))),
  loadJournals, writeJournals, generatedCoveredJournals: generated, loaded: rollbackFacts(loaded), written: rollbackFacts(written),
  ordinaryStore: { written: rollbackFacts(ordinaryWritten), journals: ordinaryJournals, removed,
    note: 'Ordinary old stores may consume resolved journals and delete unsupported orphan journals. Exact originals remain in the export and IndexedDB; journal codec proof is separate.' } }, null, 2));
