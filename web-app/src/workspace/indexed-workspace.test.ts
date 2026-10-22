import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openDraftDatabase } from './indexed-db';
import { createIndexedWorkspace } from './indexed-workspace';
import type { PersistedDraftSession } from '@/stores/draftSessionStorage';
import { initialDraftState, sessionFromState } from './draft-reducer';

const identity = { provider: 'sleeper', draftId: '123' } as const;
const pick = (slot: number, player: string) => ({ pickNumber: slot, playerId: player, playerName: player, position: 'WR' as const, teamIndex: slot - 1, teamName: `Team ${slot}` });
async function setup(factory = new IDBFactory()) {
  const report = vi.fn();
  const database = await openDraftDatabase({ factory, decode: value => structuredClone(value) as PersistedDraftSession, report });
  const workspace = createIndexedWorkspace({ database, identity, report });
  return { database, workspace, report, factory };
}

describe('transactional workspace', () => {
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

  it('serializes conflicting picks with one explicit losing result', async () => {
    const { factory, workspace: first } = await setup();
    const { workspace: second } = await setup(factory);
    const accepted = await Promise.all([first.send('recordProvisionalPick', pick(1, 'a')), second.send('recordProvisionalPick', pick(1, 'b'))]);
    expect(accepted.sort()).toEqual([false, true]);
    await second.refresh(); expect(second.draft.getState().draftHistory).toHaveLength(1); first.dispose(); second.dispose();
  });

  it('does not acknowledge or publish an aborted save, D1', async () => {
    const { database, workspace, report } = await setup();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The test restores the receiver with call.
    const original = FakeObjectStore.prototype.put;
    const put = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key);
      this.transaction.abort();
      return request;
    });
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
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The test restores the receiver with call.
    const original = FakeObjectStore.prototype.put;
    let acknowledged = false;
    let requestSucceeded = false;
    const put = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key);
      request.addEventListener('success', () => { requestSucceeded = true; expect(acknowledged).toBe(false); });
      return request;
    });
    await workspace.send('recordProvisionalPick', pick(1, 'committed')).then(() => { acknowledged = true; });
    expect(requestSucceeded).toBe(true); expect(acknowledged).toBe(true); put.mockRestore(); workspace.dispose();
  });

  it('rolls back imported facts and completion together, then retries without duplicate picks', async () => {
    const { database, workspace } = await setup();
    const session = sessionFromState({ ...initialDraftState(identity), shortlistedPlayerIds: ['imported'] }, identity, 0);
    const imported = { sessions: [session], source: [], rejected: [], unresolved: [] };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The test restores the receiver with call.
    const original = FakeObjectStore.prototype.put;
    const put = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key);
      if (this.name === 'sessions') this.transaction.abort();
      return request;
    });
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
