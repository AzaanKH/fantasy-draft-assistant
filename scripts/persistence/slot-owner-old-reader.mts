import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const [checkout, input, output, kind] = process.argv.slice(2);
if (!checkout || !input || !output || !['main', 'base'].includes(kind)) throw new Error('Pass old checkout, head bytes, output, main|base');
const load = (file: string) => import(pathToFileURL(`${checkout}/${file}`).href);
const bytes = JSON.parse(readFileSync(input, 'utf8'));
const { parseStoredDraftSession } = await load('web-app/src/stores/draftSessionStorage.ts');
const { createDraftStore } = await load('web-app/src/stores/draftStore.ts');
const identity = { provider: 'sleeper', draftId: '123' };
const key = 'fantasy-draft-session-v1:sleeper:123';
const facts = (session: Record<string, unknown>) => { const { revision: _revision, lineage: _lineage, writeId: _writeId, ...rest } = session; return rest; };
const outcomes = [];
for (const [mode, entries] of [['OFF-v1', bytes.switchOff], ['ON-record-via-v1', [[key, JSON.stringify(bytes.switchOn)]]]] as const) {
  const values = new Map<string, string>(entries);
  const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); }, removeItem: (name: string) => { values.delete(name); } };
  const before = parseStoredDraftSession(storage.getItem(key), identity);
  assert.ok(before, `${kind} rejected ${mode}`);
  const store = createDraftStore({ storage, session: identity });
  store.getState().togglePlayerShortlisted('writeback-sentinel');
  store.getState().togglePlayerShortlisted('writeback-sentinel');
  const after = parseStoredDraftSession(storage.getItem(key), identity);
  assert.ok(after);
  assert.deepEqual(facts(after), facts(before), `${kind} lost facts on ${mode} writeback`);
  outcomes.push({ mode, read: true, writeback: true, slot: after.config.myPickPosition, picks: after.draftHistory, queue: after.shortlistedPlayerIds });
  store.dispose?.();
}
if (kind === 'base') {
  const { importV1 } = await load('web-app/src/workspace/v1-import.ts');
  const { decodeIndexedSession } = await load('web-app/src/workspace/idb-session.ts');
  const { openDraftDatabase } = await load('web-app/src/workspace/indexed-db.ts');
  const { createIndexedWorkspace } = await load('web-app/src/workspace/indexed-workspace.ts');
  const { IDBFactory } = createRequire(`${checkout}/web-app/package.json`)('fake-indexeddb');
  for (const [mode, source] of [['OFF-v1-import', bytes.switchOff], ['ON-IDB-import', [[key, JSON.stringify(bytes.switchOn)]]]] as const) {
    const imported = importV1(source.filter(([key]: [string, string]) => key.startsWith('fantasy-draft-session')).map(([key, serialized]: [string, string]) => ({ key, serialized })));
    assert.equal(imported.rejected.length, 0); assert.equal(imported.unresolved.length, 0);
    const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: (error: unknown) => { throw error; } });
    await database.importV1(imported);
    const before = await database.read(identity); assert.ok(before);
    const workspace = createIndexedWorkspace({ database, identity, report: (error: unknown) => { throw error; } });
    await workspace.refresh();
    await workspace.send('addShortlistedPlayer', 'writeback-sentinel');
    await workspace.send('setPlayerShortlisted', 'writeback-sentinel', false);
    const after = await database.read(identity); assert.ok(after);
    assert.deepEqual(facts(after), facts(before));
    outcomes.push({ mode, read: true, writeback: true, slot: after.config.myPickPosition, picks: after.draftHistory, queue: after.shortlistedPlayerIds });
    workspace.dispose();
  }
}
writeFileSync(output, JSON.stringify({ checkout, kind, outcomes, pass: true }, null, 2));
