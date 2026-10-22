import { IDBFactory, IDBRequest, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_SYNC_STORAGE_KEY } from '@/stores/draftSyncStore';
import { decodeIndexedSession } from './idb-session';
import { openDraftDatabase, type DraftDatabase } from './indexed-db';
import { createDurableWorkspace } from './durable-workspace';

const identity = { provider: 'sleeper', draftId: '123' } as const;
const other = { provider: 'sleeper', draftId: '456' } as const;
const connection = { ...identity, draftPosition: 1 };
const pick = (slot: number, player: string) => ({ pickNumber: slot, playerId: player, playerName: player,
  position: 'WR' as const, teamIndex: (slot - 1) % 10, teamName: `Team ${slot}` });
const owners: Array<ReturnType<typeof createDurableWorkspace>> = [];
const stored = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value); },
  removeItem: (key: string) => { stored.delete(key); },
  clear: () => { stored.clear(); },
};
beforeEach(() => { vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage })); });
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
async function setup(factory = new IDBFactory(), initialConnection: typeof connection | null = connection) {
  const report = vi.fn();
  const database = await openDraftDatabase({ factory, decode: decodeIndexedSession, report });
  const workspace = createDurableWorkspace({ database, search: '', initialConnection, onError: report });
  owners.push(workspace);
  return { database, workspace, report, factory };
}
async function live(workspace: ReturnType<typeof createDurableWorkspace>) {
  await workspace.sendDurable(['setSessionMode', 'live']);
}
function deferredRead(database: DraftDatabase) {
  const original = database.read.bind(database);
  let release = (): void => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const read = vi.spyOn(database, 'read').mockImplementation(async identity => { await waiting; return original(identity); });
  return { release, read };
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

describe('production durable workspace', () => {
  it('does not broadcast local controls or unchanged persisted commands', async () => {
    const post = vi.fn();
    vi.stubGlobal('BroadcastChannel', class {
      postMessage = post;
      addEventListener() {}
      removeEventListener() {}
      close() {}
    });
    const { workspace } = await setup();
    await live(workspace); post.mockClear();
    await workspace.sendDurable(['setSearchQuery', 'local']);
    await workspace.sendDurable(['setConfig', { totalTeams: workspace.draft.getState().config.totalTeams }]);
    expect(post).not.toHaveBeenCalled();
    await workspace.sendDurable(['addShortlistedPlayer', 'changed']);
    expect(post).toHaveBeenCalledOnce();
  });

  it('binds the URL before accepting commands without synchronous writes or fake success', async () => {
    const { database } = await setup();
    const gate = deferredRead(database);
    localStorage.clear();
    const owner = createDurableWorkspace({ database, search: '?provider=sleeper&draftId=456&position=3', initialConnection: connection });
    owners.push(owner);
    let accepted = false;
    const pending = owner.sendDurable(['setSessionMode', 'live']).then(receipt => { accepted = true; return receipt; });
    expect(localStorage.getItem(DRAFT_SYNC_STORAGE_KEY)).toBeNull();
    expect(owner.connection.getState().connection).toBeNull();
    expect(() => owner.send('recordProvisionalPick', pick(1, 'sync'))).toThrow('sendDurable');
    await Promise.resolve();
    expect(accepted).toBe(false);
    gate.release();
    const receipt = await pending;
    expect(receipt.session?.identity).toEqual(other);
    expect(owner.connection.getState().connection).toMatchObject({ ...other, draftPosition: 3 });
    expect(await database.read(identity)).toBeNull();
  });

  it('keeps setup configuration in memory and seeds the first live transaction', async () => {
    const { database, workspace } = await setup();
    await workspace.sendDurable(['setConfig', { totalTeams: 12, totalRounds: 20 }]);
    expect(await database.read(identity)).toBeNull();
    expect(workspace.draft.getState().sessionMode).toBe('setup');
    await live(workspace);
    expect((await database.read(identity))?.config).toMatchObject({ totalTeams: 12, totalRounds: 20 });
    expect([...stored.keys()]).toEqual([DRAFT_SYNC_STORAGE_KEY]);
  });

  it('serializes user and CPU bursts, reconciliation, and absolute queue moves through reload', async () => {
    const { database, workspace, factory } = await setup();
    await live(workspace);
    const receipts = await Promise.all([
      workspace.sendDurable(['recordProvisionalPick', pick(1, 'user')]),
      workspace.sendDurable(['markPlayerDrafted', 'cpu', 'cpu', 'WR', 1, 'Team 2']),
      workspace.sendDurable(['reconcileSyncedPicks', [
        { ...pick(1, 'user'), isMyPick: true }, { ...pick(2, 'cpu'), isMyPick: false },
      ], 3, [], 100]),
      workspace.sendDurable(['recordProvisionalPick', pick(3, 'next')]),
      workspace.sendDurable(['addShortlistedPlayer', 'a']),
      workspace.sendDurable(['addShortlistedPlayer', 'b']),
      workspace.sendDurable(['moveShortlistedPlayerTo', 'b', 0]),
    ]);
    expect(receipts[0]?.result).toBe(true);
    expect(receipts[2]?.result).toMatchObject({ changed: true });
    expect(receipts[3]?.result).toBe(true);
    const saved = await database.read(identity);
    expect(saved?.draftHistory.map(value => value.playerId)).toEqual(['user', 'cpu', 'next']);
    expect(saved?.shortlistedPlayerIds).toEqual(['b', 'a']);
    workspace.dispose();
    const reloaded = await setup(factory);
    await live(reloaded.workspace);
    expect(reloaded.workspace.draft.getState().draftHistory).toEqual(saved?.draftHistory);
    expect(reloaded.workspace.draft.getState().shortlistedPlayerIds).toEqual(['b', 'a']);
  });

  it('orders connection binding, config, and writes exactly across switches and disconnect', async () => {
    const { database, workspace } = await setup();
    await live(workspace);
    await Promise.all([
      workspace.sendDurable(['recordProvisionalPick', pick(1, 'first')]),
      workspace.sendDurable(['connection.startConnection', 'sleeper', other.draftId]),
      workspace.sendDurable(['setConfig', { totalTeams: 12 }]),
      workspace.sendDurable(['connection.confirmDraftPosition', 2]),
      workspace.sendDurable(['connection.setQuickMockSettings', true]),
      workspace.sendDurable(['setSessionMode', 'live']),
      workspace.sendDurable(['recordProvisionalPick', pick(1, 'second')]),
      workspace.sendDurable(['connection.restoreConnection', connection]),
    ]);
    expect((await database.read(identity))?.draftHistory.map(value => value.playerId)).toEqual(['first']);
    expect((await database.read(other))?.draftHistory.map(value => value.playerId)).toEqual(['second']);
    expect((await database.read(other))?.config.totalTeams).toBe(12);
    expect(workspace.draft.getState().draftHistory.map(value => value.playerId)).toEqual(['first']);
    expect(workspace.connection.getState().connection).toEqual(connection);
    await workspace.sendDurable(['connection.disconnect']);
    expect(workspace.draft.getState().liveSession).toBeNull();
    expect(workspace.connection.getState().connection).toBeNull();
    expect(localStorage.getItem(DRAFT_SYNC_STORAGE_KEY)).toBeNull();
    expect((await workspace.sendDurable(['addShortlistedPlayer', 'memory'])).session).toBeNull();
    expect((await database.read(identity))?.shortlistedPlayerIds).toEqual([]);
  });

  it('keeps mock auto-advance in memory and restores live facts and local controls', async () => {
    const { database, workspace } = await setup();
    await live(workspace);
    await workspace.sendDurable(['recordProvisionalPick', pick(1, 'live')]);
    const saved = await database.read(identity);
    await workspace.sendDurable(['setSessionMode', 'mock']);
    await Promise.all([
      workspace.sendDurable(['setSearchQuery', 'kept']),
      workspace.sendDurable(['setMockSettings', { randomness: 0.7 }]),
      workspace.sendDurable(['markPlayerDrafted', 'cpu', 'cpu', 'WR', 0, 'Team 1', undefined, 'cpu']),
      workspace.sendDurable(['markPlayerDrafted', 'user', 'user', 'WR', 1, 'Team 2']),
    ]);
    const mock = workspace.draft.getState().draftHistory;
    expect(mock.map(value => value.playerId)).toEqual(['cpu', 'user']);
    expect(await database.read(identity)).toEqual(saved);
    await live(workspace);
    expect(workspace.draft.getState()).toMatchObject({ filter: { searchQuery: 'kept' }, mockSettings: { randomness: 0.7 } });
    expect(workspace.draft.getState().draftHistory.map(value => value.playerId)).toEqual(['live']);
    await workspace.sendDurable(['setSessionMode', 'mock']);
    expect(workspace.draft.getState().draftHistory).toEqual(mock);
    expect([...stored.keys()]).toEqual([DRAFT_SYNC_STORAGE_KEY]);
  });

  it('supports unconnected setup and mock but refuses memory-only live acceptance', async () => {
    const { database, workspace } = await setup(new IDBFactory(), null);
    await expect(workspace.sendDurable(['setSessionMode', 'live'])).rejects.toThrow('Connect a draft');
    await workspace.sendDurable(['setConfig', { totalTeams: 2, totalRounds: 2 }]);
    await workspace.sendDurable(['setSessionMode', 'mock']);
    const receipt = await workspace.sendDurable(['markPlayerDrafted', 'cpu', 'CPU', 'WR', 0, 'Team 1', undefined, 'cpu']);
    expect(receipt.session).toBeNull();
    expect(workspace.draft.getState().draftHistory.map(value => value.playerId)).toEqual(['cpu']);
    expect(await database.read(identity)).toBeNull();
    expect([...stored.keys()]).toEqual([]);
  });

  it('keeps mock picks out of a connected draft that has never had a live save', async () => {
    const { database, workspace } = await setup();
    await workspace.sendDurable(['setConfig', { totalTeams: 12 }]);
    await workspace.sendDurable(['setSessionMode', 'mock']);
    await workspace.sendDurable(['markPlayerDrafted', 'cpu', 'CPU', 'WR', 0, 'Team 1', undefined, 'cpu']);
    await live(workspace);
    expect((await database.read(identity))?.draftHistory).toEqual([]);
    expect((await database.read(identity))?.config.totalTeams).toBe(12);
    await workspace.sendDurable(['setSessionMode', 'mock']);
    expect(workspace.draft.getState().draftHistory.map(value => value.playerId)).toEqual(['cpu']);
  });

  it('rereads live facts on focus and visibility while retaining local controls', async () => {
    const document = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
    vi.stubGlobal('document', document);
    const first = await setup();
    const second = await setup(first.factory);
    await Promise.all([live(first.workspace), live(second.workspace)]);
    await first.workspace.sendDurable(['setSearchQuery', 'kept']);
    await second.workspace.sendDurable(['addShortlistedPlayer', 'focus']);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => { expect(first.workspace.draft.getState().shortlistedPlayerIds).toEqual(['focus']); });
    await second.workspace.sendDurable(['addShortlistedPlayer', 'visible']);
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => { expect(first.workspace.draft.getState().shortlistedPlayerIds).toEqual(['focus', 'visible']); });
    expect(first.workspace.draft.getState().filter.searchQuery).toBe('kept');
    first.workspace.dispose();
    const read = vi.spyOn(first.database, 'read');
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(read).not.toHaveBeenCalled();
  });

  it('acknowledges only after the complete transaction and publishes the accepted facts', async () => {
    const { workspace } = await setup();
    await live(workspace);
    let acknowledged = false;
    let requestSucceeded = false;
    const put = interceptPut((_store, request) => {
      request.addEventListener('success', () => { requestSucceeded = true; expect(acknowledged).toBe(false); });
    });
    const receipt = await workspace.sendDurable(['recordProvisionalPick', pick(1, 'committed')]).then(value => {
      acknowledged = true;
      return value;
    });
    expect(requestSucceeded).toBe(true);
    expect(receipt.result).toBe(true);
    expect(receipt.session?.draftHistory.map(value => value.playerId)).toEqual(['committed']);
    expect(workspace.draft.getState().draftHistory).toEqual(receipt.session?.draftHistory);
    put.mockRestore();
  });

  it('rejects a failed bind without publishing or persisting the next identity, and continues the queue', async () => {
    const { database, workspace, report } = await setup();
    await live(workspace);
    const read = vi.spyOn(database, 'read').mockRejectedValueOnce(new Error('Unreadable session'));
    await expect(workspace.sendDurable(['connection.startConnection', 'sleeper', other.draftId])).rejects.toThrow('Unreadable');
    read.mockRestore();
    expect(workspace.connection.getState().connection).toEqual(connection);
    expect(workspace.draft.getState().liveSession).toEqual(identity);
    expect(JSON.parse(localStorage.getItem(DRAFT_SYNC_STORAGE_KEY) ?? 'null')).toEqual(connection);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unreadable session' }));
    expect((await workspace.sendDurable(['recordProvisionalPick', pick(1, 'retained')])).result).toBe(true);
  });

  it('never falls back to memory after initialization fails', async () => {
    const { database } = await setup();
    vi.spyOn(database, 'read').mockRejectedValue(new Error('IDB unavailable'));
    const owner = createDurableWorkspace({ database, search: '', initialConnection: connection });
    owners.push(owner);
    await expect(owner.sendDurable(['addShortlistedPlayer', 'lost'])).rejects.toThrow('IDB unavailable');
    expect(owner.draft.getState().shortlistedPlayerIds).toEqual([]);
    expect(owner.connection.getState().connection).toBeNull();
  });

  it('returns one explicit loser for conflicting cross-owner picks', async () => {
    const first = await setup();
    const second = await setup(first.factory);
    await Promise.all([live(first.workspace), live(second.workspace)]);
    const receipts = await Promise.all([
      first.workspace.sendDurable(['recordProvisionalPick', pick(1, 'a')]),
      second.workspace.sendDurable(['recordProvisionalPick', pick(1, 'b')]),
    ]);
    expect(receipts.map(value => value.result).sort()).toEqual([false, true]);
    expect((await first.database.read(identity))?.draftHistory).toHaveLength(1);
  });

  it('does not publish or acknowledge an aborted transaction', async () => {
    const { database, workspace } = await setup();
    await live(workspace);
    const put = interceptPut(store => { store.transaction.abort(); });
    await expect(workspace.sendDurable(['recordProvisionalPick', pick(1, 'lost')])).rejects.toThrow();
    put.mockRestore();
    expect(workspace.draft.getState().draftHistory).toEqual([]);
    expect((await database.read(identity))?.draftHistory).toEqual([]);
  });

  it('blocks queued writes and stale bind results after disposal and closes only once', async () => {
    const { database, workspace } = await setup();
    await live(workspace);
    const close = vi.spyOn(database, 'close');
    const update = vi.spyOn(database, 'update');
    const gate = deferredRead(database);
    const switching = workspace.sendDurable(['connection.startConnection', 'sleeper', other.draftId]);
    const pickResult = workspace.sendDurable(['recordProvisionalPick', pick(1, 'queued')]);
    const settled = Promise.allSettled([switching, pickResult]);
    await vi.waitFor(() => { expect(gate.read).toHaveBeenCalledWith(other); });
    workspace.dispose(); workspace.dispose();
    gate.release();
    expect((await settled).map(value => value.status)).toEqual(['rejected', 'rejected']);
    expect(update).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(workspace.connection.getState().connection).toEqual(connection);
    expect(workspace.draft.getState().liveSession).toEqual(identity);
    await expect(workspace.sendDurable(['resetDraft'])).rejects.toThrow('disposed');
  });

  it('aborts a started transaction if disposal happens before its reducer runs', async () => {
    const { database, workspace, factory } = await setup();
    await live(workspace);
    const update = database.update.bind(database);
    vi.spyOn(database, 'update').mockImplementation((identity, apply) => {
      const pending = update(identity, apply);
      workspace.dispose();
      return pending;
    });
    await expect(workspace.sendDurable(['recordProvisionalPick', pick(1, 'cancelled')])).rejects.toThrow('disposed');
    const reloaded = await setup(factory);
    await live(reloaded.workspace);
    expect(reloaded.workspace.draft.getState().draftHistory).toEqual([]);
  });
});
