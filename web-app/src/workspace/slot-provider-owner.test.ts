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

it('a late provider settings hint cannot configure the newly selected draft', () => {
  const workspace = createWorkspace({ draftStore: createDraftStore(), initialConnection: { ...identity, draftPosition: 3 } });
  const before = workspace.draft.getState();
  workspace.send('connection.applyProviderSettings', { provider: 'sleeper', draftId: 'different',
    config: { totalTeams: 20, totalRounds: 20, draftType: 'linear' }, leagueSettings: before.leagueSettings });
  expect(workspace.draft.getState().config).toEqual(before.config);
  workspace.dispose();
});

it('the suspended live draft owns the connection during a mock and disconnect clears it', () => {
  const workspace = createWorkspace({ draftStore: createDraftStore(), initialConnection: { ...identity, draftPosition: 3 } });
  workspace.send('connection.confirmDraftPosition', 3);
  workspace.send('setSessionMode', 'mock');
  workspace.send('setConfig', { myPickPosition: 8 });
  expect(workspace.connection.getState().connection?.draftPosition).toBe(3);
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
