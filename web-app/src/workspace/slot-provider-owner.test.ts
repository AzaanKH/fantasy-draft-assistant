import { describe, expect, it } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { resolveInitialConnection } from './connection-hints';
import { createWorkspace } from './workspace';

const identity = { provider: 'sleeper', draftId: '123' } as const;
describe('slot and provider ownership regressions', () => {
  it('reads a later user slot from the same owner as the draft config', () => {
    const workspace = createWorkspace({ draftStore: createDraftStore(), initialConnection: { ...identity, draftPosition: 3 } });
    workspace.send('connection.confirmDraftPosition', 3);
    workspace.send('setConfig', { myPickPosition: 8 });
    expect(workspace.connection.getState().connection?.draftPosition).toBe(8);
    workspace.dispose();
  });
  it('ignores a stale URL slot when its identity differs from the saved connection', () => {
    expect(resolveInitialConnection('?provider=sleeper&draftId=456&position=9', { ...identity, draftPosition: 3 }))
      .toMatchObject({ draftId: '456', draftPosition: null });
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

it('reload and reconnect prefer the saved session over a launch slot hint', () => {
  const storage = memoryStorage();
  const first = createWorkspace({ draftStore: createDraftStore({ storage }), initialConnection: { ...identity, draftPosition: 3 } });
  first.send('connection.confirmDraftPosition', 3);
  first.send('setConfig', { myPickPosition: 8 });
  first.send('connection.startConnection', 'sleeper', identity.draftId);
  expect(first.connection.getState().connection?.draftPosition).toBe(8);
  first.dispose();
  const reloaded = createWorkspace({ draftStore: createDraftStore({ storage }), initialConnection: { ...identity, draftPosition: 3 } });
  expect(reloaded.draft.getState().config.myPickPosition).toBe(8);
  expect(reloaded.connection.getState().connection?.draftPosition).toBe(8);
  reloaded.dispose();
});

it('an extension slot hint is consumed once and cannot overwrite a later user choice', () => {
  const workspace = createWorkspace({ draftStore: createDraftStore() });
  const hint = { ...identity, draftPosition: 3 };
  workspace.send('connection.applyHint', hint);
  expect(workspace.draft.getState().config.myPickPosition).toBe(3);
  workspace.send('setConfig', { myPickPosition: 8 });
  workspace.send('connection.applyHint', hint);
  expect(workspace.connection.getState().connection?.draftPosition).toBe(8);
  workspace.dispose();
});

it('a second v1 tab updates the connection query through the draft config without a mirror', () => {
  const storage = memoryStorage();
  let notify: ((key: string | null, value: string | null) => void) | undefined;
  const first = createWorkspace({ draftStore: createDraftStore({ storage }), initialConnection: { ...identity, draftPosition: 3 } });
  first.send('connection.confirmDraftPosition', 3);
  const second = createWorkspace({ draftStore: createDraftStore({ storage, externalChanges: callback => { notify = callback; return () => {}; } }), initialConnection: { ...identity, draftPosition: 3 } });
  const seen: number[] = [];
  const stop = second.connection.subscribe(state => { if (state.connection?.draftPosition) seen.push(state.connection.draftPosition); });
  first.send('setConfig', { myPickPosition: 8 });
  const key = `fantasy-draft-session-v1:${identity.provider}:${identity.draftId}`;
  notify?.(key, storage.getItem(key));
  expect(second.connection.getState().connection?.draftPosition).toBe(8);
  expect(seen).toContain(8);
  stop(); first.dispose(); second.dispose();
});

it('a late provider settings hint cannot configure the newly selected draft', () => {
  const workspace = createWorkspace({ draftStore: createDraftStore(), initialConnection: { ...identity, draftPosition: 3 } });
  const before = workspace.draft.getState();
  workspace.send('connection.applyProviderSettings', { provider: 'sleeper', draftId: 'different',
    config: { totalTeams: 20, totalRounds: 20, draftType: 'linear' }, leagueSettings: before.leagueSettings });
  expect(workspace.draft.getState().config).toEqual(before.config);
  workspace.dispose();
});

it('the suspended live draft owns the connection during a mock and disconnect clears it', () => {
  const workspace = createWorkspace({ draftStore: createDraftStore({ storage: memoryStorage() }), initialConnection: { ...identity, draftPosition: 3 } });
  workspace.send('connection.confirmDraftPosition', 3);
  workspace.send('setSessionMode', 'mock');
  workspace.send('setConfig', { myPickPosition: 8 });
  expect(workspace.connection.getState().connection?.draftPosition).toBe(3);
  workspace.send('setSessionMode', 'live');
  expect(workspace.connection.getState().connection?.draftPosition).toBe(3);
  workspace.send('setSessionMode', 'mock');
  workspace.send('connection.disconnect');
  expect(workspace.connection.getState().connection).toBeNull();
  workspace.dispose();
});

it('unrelated edits neither clear another tab connection nor overwrite its hint', () => {
  let stored = '';
  const persist = (value: unknown) => { stored = JSON.stringify(value); };
  const unbound = createWorkspace({ draftStore: createDraftStore(), persist });
  const first = createWorkspace({ draftStore: createDraftStore(), initialConnection: { ...identity, draftPosition: 3 }, persist });
  const second = createWorkspace({ draftStore: createDraftStore(), initialConnection: { ...identity, draftId: '456', draftPosition: 6 }, persist });
  const latest = stored;
  unbound.send('setSearchQuery', 'unrelated');
  expect(stored).toBe(latest);
  first.send('setSearchQuery', 'also unrelated');
  expect(stored).toBe(latest);
  first.send('connection.disconnect');
  expect(stored).toBe('null');
  unbound.dispose(); first.dispose(); second.dispose();
});
