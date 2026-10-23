import { IDBFactory, IDBRequest, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openDraftDatabase } from './indexed-db';
import { createIndexedWorkspace } from './indexed-workspace';
import type { PersistedDraftSession } from '@/stores/draftSessionStorage';
import { initialDraftState, sessionFromState } from './draft-reducer';
import { decodeIndexedSession } from './idb-session';

const identity = { provider: 'sleeper', draftId: '123' } as const;
const pick = (slot: number, player: string) => ({ pickNumber: slot, playerId: player, playerName: player, position: 'WR' as const, teamIndex: slot - 1, teamName: `Team ${slot}` });
async function setup(factory = new IDBFactory()) {
  const report = vi.fn();
  const database = await openDraftDatabase({ factory, decode: value => structuredClone(value) as PersistedDraftSession, report });
  const workspace = createIndexedWorkspace({ database, identity, report });
  return { database, workspace, report, factory };
}

function interceptPut(after: (store: IDBObjectStore, request: IDBRequest<unknown>) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(FakeObjectStore.prototype, 'put');
  const original: unknown = descriptor?.value;
  if (!descriptor || typeof original !== 'function') throw new Error('Missing IndexedDB put implementation');
  Object.defineProperty(FakeObjectStore.prototype, 'put', { ...descriptor, value(this: IDBObjectStore, value: unknown, key?: IDBValidKey): unknown {
    const request: unknown = Reflect.apply(original, this, [value, key]);
    if (!(request instanceof IDBRequest)) throw new Error('Invalid IndexedDB request');
    after(this, request);
    return request;
  } });
  return { mockRestore: () => { Object.defineProperty(FakeObjectStore.prototype, 'put', descriptor); } };
}

describe('transactional workspace', () => {
  it.fails('acknowledges a repeated keeper preload without a new revision when only key order differs from the decoded session', async () => {
    const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: vi.fn() });
    const channel = { postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn() };
    const workspace = createIndexedWorkspace({ database, identity, report: vi.fn(), channel });
    const first = await workspace.commit('preloadKeepers', [], false);
    const state = workspace.draft.getState(); channel.postMessage.mockClear();
    const notify = vi.fn(); const stop = workspace.draft.subscribe(notify);
    const repeated = await workspace.commit('preloadKeepers', [], false);
    expect(repeated.session.revision).toBe(first.session.revision);
    expect((await database.read(identity))?.revision).toBe(first.session.revision);
    expect(workspace.draft.getState().leagueSettings).toBe(state.leagueSettings);
    expect(channel.postMessage).not.toHaveBeenCalled();
    expect(notify.mock.calls.every(([next]) => (next as typeof state).leagueSettings === state.leagueSettings)).toBe(true);
    stop(); workspace.dispose();
  });

  it('does not publish unchanged revisions during focus or notification re-reads', async () => {
    const { workspace } = await setup();
    await workspace.send('addShortlistedPlayer', 'saved');
    const state = workspace.draft.getState();
    const notify = vi.fn(); const stop = workspace.draft.subscribe(notify);
    await workspace.refresh(); await workspace.refresh();
    expect(workspace.draft.getState()).toBe(state);
    expect(notify).not.toHaveBeenCalled();
    stop(); workspace.dispose();
  });

  it('retains two acknowledged saves despite another writer starting from stale state, D3', async () => {
    const { factory, workspace: first } = await setup();
    const { workspace: second } = await setup(factory);
    expect(await first.send('recordProvisionalPick', pick(1, 'a'))).toBe(true);
    expect(await first.send('recordProvisionalPick', pick(2, 'b'))).toBe(true);
    await second.send('togglePlayerShortlisted', 'queue');
    first.dispose(); second.dispose();
    const reloaded = await setup(factory); await reloaded.workspace.refresh();
    expect(reloaded.workspace.draft.getState().draftHistory.map(pick => pick.playerId)).toEqual(['a', 'b']);
    expect(reloaded.workspace.draft.getState().shortlistedPlayerIds).toEqual(['queue']); reloaded.workspace.dispose();
  });

  it('keeps local controls across durable commits and refresh without writing or broadcasting them', async () => {
    const { factory, database } = await setup();
    const channel = { postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn() };
    const reader = createIndexedWorkspace({ database, identity, report: vi.fn(), channel });
    await reader.send('addShortlistedPlayer', 'initial');
    const before = await database.read(identity);
    channel.postMessage.mockClear();
    await reader.send('setSearchQuery', 'mahomes');
    await reader.send('setPositionFilter', 'QB');
    await reader.send('setMockSettings', { randomness: 0.75 });
    await reader.send('setMockAutoAdvancePaused', true);
    await reader.send('setMockSettingsOpen', true);
    await reader.send('setMockSurvivalProbabilities', { qb: 0.5 });
    expect(await database.read(identity)).toEqual(before);
    expect(channel.postMessage).not.toHaveBeenCalled();
    const { workspace: writer } = await setup(factory);
    await writer.send('addShortlistedPlayer', 'remote');
    await reader.refresh();
    await reader.send('setDecisionLens', 'best-player');
    expect(reader.draft.getState()).toMatchObject({ filter: { searchQuery: 'mahomes', position: 'QB' },
      mockSettings: { randomness: 0.75 }, mockAutoAdvance: { paused: true, settingsOpen: true }, mockSurvivalProbabilities: { qb: 0.5 },
      shortlistedPlayerIds: ['initial', 'remote'] });
    const acknowledged = await database.read(identity);
    channel.postMessage.mockClear();
    expect(await reader.send('recordProvisionalPick', pick(141, 'out-of-range'))).toBe(false);
    await reader.send('addShortlistedPlayer', 'initial');
    expect(await database.read(identity)).toEqual(acknowledged);
    expect(channel.postMessage).not.toHaveBeenCalled();
    await expect(reader.send('setSessionMode', 'mock')).rejects.toThrow('separate workspace');
    reader.dispose(); writer.dispose();
  });

  it('serializes conflicting picks with one explicit losing result', async () => {
    const { factory, workspace: first } = await setup();
    const { workspace: second } = await setup(factory);
    const accepted = await Promise.all([first.send('recordProvisionalPick', pick(1, 'a')), second.send('recordProvisionalPick', pick(1, 'b'))]);
    expect(accepted.sort()).toEqual([false, true]);
    await second.refresh(); expect(second.draft.getState().draftHistory).toHaveLength(1); first.dispose(); second.dispose();
  });

  it('does not acknowledge or publish an aborted save, D1', async () => {
    const { database, workspace, report } = await setup();
    const put = interceptPut(store => { store.transaction.abort(); });
    await expect(workspace.send('recordProvisionalPick', pick(1, 'lost'))).rejects.toThrow();
    expect(workspace.draft.getState().draftHistory).toEqual([]);
    put.mockRestore(); expect(await database.read(identity)).toBeNull();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ phase: 'abort' })); workspace.dispose();
  });

  it('keeps the exact queue order through concurrent absolute moves and reload', async () => {
    const { factory, workspace: first } = await setup();
    const { workspace: second } = await setup(factory);
    for (const player of ['p0', 'p1', 'p2', 'p3']) await first.send('togglePlayerShortlisted', player);
    await Promise.all([first.send('moveShortlistedPlayerTo', 'p1', 0), second.send('moveShortlistedPlayerTo', 'p1', 3)]);
    await first.refresh(); expect(first.draft.getState().shortlistedPlayerIds).toEqual(['p0', 'p2', 'p3', 'p1']);
    first.dispose(); second.dispose();
    const reloaded = await setup(factory); await reloaded.workspace.refresh();
    expect(reloaded.workspace.draft.getState().shortlistedPlayerIds).toEqual(['p0', 'p2', 'p3', 'p1']); reloaded.workspace.dispose();
  });

  it('rereads missed notifications on focus and visibility, and disposes both callbacks', async () => {
    const { factory, database } = await setup();
    const focus = new EventTarget(); const visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' as const });
    const reader = createIndexedWorkspace({ database, identity, report: vi.fn(), lifecycle: { window: focus, document: visibility } });
    const { workspace: writer } = await setup(factory);
    await writer.send('togglePlayerShortlisted', 'focus'); focus.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => { expect(reader.draft.getState().shortlistedPlayerIds).toEqual(['focus']); });
    await writer.send('togglePlayerShortlisted', 'visible'); visibility.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => { expect(reader.draft.getState().shortlistedPlayerIds).toEqual(['focus', 'visible']); });
    const read = vi.spyOn(database, 'read'); reader.dispose(); focus.dispatchEvent(new Event('focus')); visibility.dispatchEvent(new Event('visibilitychange'));
    expect(read).not.toHaveBeenCalled(); writer.dispose();
  });

  it('waits past request success before acknowledging the transaction', async () => {
    const { workspace } = await setup();
    let acknowledged = false;
    let requestSucceeded = false;
    const put = interceptPut((_store, request) => {
      request.addEventListener('success', () => { requestSucceeded = true; expect(acknowledged).toBe(false); });
    });
    await workspace.send('recordProvisionalPick', pick(1, 'committed')).then(() => { acknowledged = true; });
    expect(requestSucceeded).toBe(true); expect(acknowledged).toBe(true); put.mockRestore(); workspace.dispose();
  });

  it('rolls back imported facts and completion together, then retries without duplicate picks', async () => {
    const { database, workspace } = await setup();
    const session = sessionFromState({ ...initialDraftState(identity), shortlistedPlayerIds: ['imported'] }, identity, 0);
    const imported = { sessions: [session], source: [], rejected: [], unresolved: [] };
    const put = interceptPut(store => { if (store.name === 'sessions') store.transaction.abort(); });
    await expect(database.importV1(imported)).rejects.toThrow(); put.mockRestore();
    expect(await database.read(identity)).toBeNull();
    await database.importV1(imported); await database.importV1(imported);
    expect((await database.read(identity))?.shortlistedPlayerIds).toEqual(['imported']); workspace.dispose();
  });

  it('imports later sessions and resolves a retried import before any IDB command', async () => {
    const { database, workspace } = await setup();
    const first = sessionFromState(initialDraftState(identity), identity, 1);
    await database.importV1({ sessions: [first], source: [], rejected: [], unresolved: [] });
    const resolved = { ...first, shortlistedPlayerIds: ['resolved'], revision: 2 };
    const other = { ...first, identity: { ...identity, draftId: '456' } };
    await database.importV1({ sessions: [resolved, other], source: [], rejected: [], unresolved: [] });
    expect((await database.read(identity))?.shortlistedPlayerIds).toEqual(['resolved']);
    expect((await database.read(other.identity))?.identity).toEqual(other.identity); workspace.dispose();
  });

  it('deduplicates identical raw import snapshots and retains a changed refused source', async () => {
    const { database, workspace } = await setup();
    const session = sessionFromState(initialDraftState(identity), identity, 1);
    const source = [{ key: 'fantasy-draft-session-v1:sleeper:123', serialized: JSON.stringify(session) }];
    const value = { sessions: [session], source, rejected: [], unresolved: [] };
    await database.importV1(value);
    const count = (await database.inspectImports()).length;
    await database.importV1(value);
    expect((await database.inspectImports()).length).toBe(count);
    await workspace.send('addShortlistedPlayer', 'acknowledged');
    expect((await database.importV1(value)).refused).toEqual([]);
    const changedSession = { ...session, shortlistedPlayerIds: ['late-v1'] };
    const changed = { ...value, sessions: [changedSession], source: [{ key: 'fantasy-draft-session-v1:sleeper:123', serialized: JSON.stringify(changedSession) }] };
    expect((await database.importV1(changed)).refused).toEqual([expect.objectContaining({ identity })]);
    expect((await database.read(identity))?.shortlistedPlayerIds).toEqual(['acknowledged']);
    const records = await database.inspectImports();
    expect(records.filter(row => typeof row === 'object' && row !== null && 'reason' in row)).toMatchObject([{ identity, source: changed.source }]);
    workspace.dispose();
  });

  it('records import completion and facts together and retains raw unresolved journals, D6', async () => {
    const { database, workspace } = await setup();
    const session = sessionFromState(initialDraftState(identity), identity, 0);
    const source = [{ key: 'journal', serialized: 'raw' }];
    const unresolved = [{ key: 'journal', serialized: 'raw', change: { writeId: 'dependent', baseWriteId: 'missing', revision: 2, picks: [], fields: {}, queueAdded: ['retained'], queueRemoved: [] } }];
    await database.importV1({ sessions: [session], source, rejected: [], unresolved });
    expect(await database.inspectImports()).toContainEqual(expect.objectContaining({ source, unresolved }));
    await workspace.send('togglePlayerShortlisted', 'new');
    await database.importV1({ sessions: [session], source, rejected: [], unresolved: [] });
    expect((await database.read(identity))?.shortlistedPlayerIds).toEqual(['new']); workspace.dispose();
  });
});
