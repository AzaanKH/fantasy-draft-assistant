import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const [checkout, input, output, kind] = process.argv.slice(2);
if (!checkout || !input || !output || !['main', 'base'].includes(kind)) throw new Error('Pass old checkout, head bytes, output, main|base');
const values = new Map<string, string>(JSON.parse(readFileSync(input, 'utf8')).switchOff);
const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { localStorage: storage }) });
const load = (file: string) => import(pathToFileURL(`${checkout}/${file}`).href);
const hints = await load('web-app/src/stores/draftSyncStore.ts');
const { createDraftStore } = await load('web-app/src/stores/draftStore.ts');
const { parseStoredDraftSession } = await load('web-app/src/stores/draftSessionStorage.ts');
const identity = { provider: 'sleeper', draftId: '123' };
const sessionKey = 'fantasy-draft-session-v1:sleeper:123';
const hintKey = hints.DRAFT_SYNC_STORAGE_KEY;
const connectionStore = kind === 'main' ? hints.useDraftSyncConnectionStore : hints.createDraftSyncConnectionStore({ initialConnection: hints.parseStoredDraftSyncConnection(storage.getItem(hints.DRAFT_SYNC_STORAGE_KEY)), persist: hints.persistConnection });
const draft = createDraftStore({ storage, session: identity });
const workspace = kind === 'base' ? (await load('web-app/src/workspace/workspace.ts')).createWorkspace({ draftStore: draft, connectionStore }) : null;
const source = readFileSync(`${checkout}/web-app/src/features/draft-room/LiveDraftSyncProvider.tsx`, 'utf8');
const mirrors = source.match(/React\.useEffect\(\(\) => \{\n    if \(connection\?\.draftPosition === null[\s\S]*?\n  \}, \[connection,[^\n]*\]\);/g);
assert.equal(mirrors?.length, 1, 'Locate the actual pinned mirror effect');
const { transpile } = createRequire(`${checkout}/web-app/package.json`)('typescript');
const mirror = transpile(mirrors![0]);
const stages: { stage: string; hint: number; slot: number }[] = [];
function applyMirror(stage: string, expected: number): void {
  runInNewContext(mirror, { React: { useEffect: (effect: () => void) => { effect(); } },
    connection: connectionStore.getState().connection, setConfig: draft.getState().setConfig,
    setSessionMode: draft.getState().setSessionMode, workspace, STORAGE_ACTIVATION_ENABLED: false });
  const slot = parseStoredDraftSession(storage.getItem(sessionKey), identity).config.myPickPosition;
  const hint = connectionStore.getState().connection.draftPosition;
  assert.equal(slot, expected); assert.equal(hint, expected);
  stages.push({ stage, slot, hint });
}
function reload(search: string): void {
  connectionStore.getState().restoreConnection(hints.parseStoredDraftSyncConnection(storage.getItem(hints.DRAFT_SYNC_STORAGE_KEY)));
  if (kind === 'main') hints.initializeDraftSyncConnection(search);
  else hints.initializeDraftSyncConnection(connectionStore, search);
}
applyMirror('old tab reads head-written hint', 8);
const canonical = '?provider=sleeper&draftId=123&position=8';
reload(canonical); applyMirror('old mirror after canonical reload', 8);
const hintSource = readFileSync(`${checkout}/web-app/src/stores/draftSyncStore.ts`, 'utf8');
const writer = hintSource.match(/(?:export )?function persistConnection\(connection[\s\S]*?\n\}/)?.[0];
assert.ok(writer, 'Locate the pinned old hint writer');
runInNewContext(transpile(writer.replace(/^export /, '')) + ';persistConnection(stale)', { window, DRAFT_SYNC_STORAGE_KEY: hintKey, stale: { ...identity, draftPosition: 3 } });
const staleHintOnly = [...values];
assert.equal(parseStoredDraftSession(storage.getItem(sessionKey), identity).config.myPickPosition, 8);
reload(canonical); applyMirror('stale hint cannot flip canonical reload', 8);
connectionStore.getState().confirmDraftPosition(6);
applyMirror('newer explicit old-tab user choice', 6);
const newerChoice = [...values];
workspace?.dispose(); if (!workspace) draft.dispose?.();
writeFileSync(output, JSON.stringify({ kind, checkout, stages, staleHintOnly, newerChoice,
  mirrorSourceSha256: createHash('sha256').update(mirrors![0]).digest('hex'), mirrorSource: mirrors![0], pass: true }, null, 2));
