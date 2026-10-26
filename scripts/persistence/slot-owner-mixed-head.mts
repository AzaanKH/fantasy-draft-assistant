import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createDraftStore } from '../../web-app/src/stores/draftStore';
import { createWorkspace } from '../../web-app/src/workspace/workspace';
import { resolveInitialConnection, parseStoredDraftSyncConnection } from '../../web-app/src/workspace/connection-hints';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Pass old mixed-version output and proof path');
const original = JSON.parse(readFileSync(input, 'utf8'));
const values = new Map<string, string>(original.staleHintOnly);
const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
const stale = { provider: 'sleeper' as const, draftId: '123', draftPosition: 3 };
let notify: ((key: string, value: string | null) => void) | undefined;
const stored = parseStoredDraftSyncConnection(storage.getItem('fantasy-draft-live-sync-v1'));
const workspace = createWorkspace({ draftStore: createDraftStore({ storage, externalChanges: callback => { notify = callback; return () => {}; } }),
  initialConnection: resolveInitialConnection('?provider=sleeper&draftId=123&position=3', stored) });
const outcomes = [];
function check(stage: string, expected: number): void {
  assert.equal(workspace.connection.getState().connection?.draftPosition, expected);
  workspace.send('connection.applyHint', stale);
  assert.equal(workspace.connection.getState().connection?.draftPosition, expected);
  const reloaded = createWorkspace({ draftStore: createDraftStore({ storage }), initialConnection: stale });
  assert.equal(reloaded.connection.getState().connection?.draftPosition, expected);
  outcomes.push({ stage, activeHead: workspace.connection.getState().connection?.draftPosition, afterStaleHint: expected,
    afterReload: reloaded.connection.getState().connection?.draftPosition });
  reloaded.dispose();
}
check('stale old hint alone', 8);
values.clear(); for (const [key, value] of original.newerChoice) values.set(key, value);
const key = 'fantasy-draft-session-v1:sleeper:123';
notify?.(key, storage.getItem(key));
check('newer explicit old-tab choice in session revision', 6);
workspace.dispose();
writeFileSync(output, JSON.stringify({ oldSource: original.kind, outcomes, pass: true }, null, 2));
