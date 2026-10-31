import { importV1 } from './v1-import';
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { decodeIndexedSession } from './idb-session';
import { initialDraftState, reduceDraftCommand, sessionFromState } from './draft-reducer';
import { openDraftDatabase } from './indexed-db';
import { createIndexedWorkspace } from './indexed-workspace';

const identity = { provider: 'sleeper', draftId: '123' } as const;
const provisional = (slot: number) => ({ pickNumber: slot, playerId: `p${slot}`, playerName: `P${slot}`, position: 'WR' as const, teamIndex: slot - 1, teamName: `Team ${slot}` });

describe('IndexedDB session boundary', () => {
  it('keeps a native insertion-order progress anchor through repeated command reads', async () => {
    let state = initialDraftState(identity);
    state = reduceDraftCommand(state, ['recordProvisionalPick', provisional(1)]).state;
    state = reduceDraftCommand(state, ['recordProvisionalPick', provisional(3)]).state;
    state = reduceDraftCommand(state, ['markPlayerDrafted', 'p2', 'P2', 'WR', 1, 'Team 2', 2]).state;
    const session = sessionFromState(state, identity, 1);
    expect(session.currentPick).toBe(3);
    expect(session.draftHistory.map(pick => pick.pickNumber)).toEqual([1, 3, 2]);
    expect(decodeIndexedSession(session).draftProgress).toEqual(session.draftProgress);
    const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: error => { throw error instanceof Error ? error : new Error('Unexpected storage diagnostic'); } });
    await database.importV1({ sessions: [session], source: [], rejected: [], unresolved: [] });
    const workspace = createIndexedWorkspace({ database, identity, report: error => { throw error instanceof Error ? error : new Error('Unexpected storage diagnostic'); } });
    await workspace.send('addShortlistedPlayer', 'waiting'); await workspace.send('setDecisionLens', 'best-player');
    expect((await workspace.readPersisted())?.draftProgress).toEqual(session.draftProgress);
    expect((await workspace.readPersisted())?.currentPick).toBe(3); workspace.dispose();
  });

  it('keeps the imported accepted prefix fixed when a later manual pick inserts an earlier slot', async () => {
    const state = initialDraftState(identity);
    const history = [provisional(1), provisional(3)].map(pick => ({ ...pick, source: 'manual' as const, timestamp: 0 }));
    const session = sessionFromState({ ...state, draftHistory: history,
      draftProgress: { anchor: { kind: 'first-open', keeperSlots: [], totalPicks: 140 }, historyLength: 2 } }, identity, 1);
    const imported = importV1([{ key: 'fantasy-draft-session-v1:sleeper:123', serialized: JSON.stringify(session) }]);
    const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: () => undefined });
    await database.importV1(imported);
    const workspace = createIndexedWorkspace({ database, identity, report: () => undefined });
    await workspace.send('markPlayerDrafted', 'p2', 'P2', 'WR', 1, 'Team 2', 2);
    expect((await workspace.readPersisted())?.currentPick).toBe(3);
    expect((await workspace.readPersisted())?.draftHistory.map(pick => pick.pickNumber)).toEqual([1, 3, 2]); workspace.dispose();
  });

  it('aborts invalid reducer output without damaging the last acknowledged session', async () => {
    const state = initialDraftState(identity);
    const history = [provisional(1), provisional(3)].map(pick => ({ ...pick, source: 'manual' as const, timestamp: 0 }));
    const session = sessionFromState({ ...state, draftHistory: history,
      draftProgress: { anchor: { kind: 'first-open', keeperSlots: [], totalPicks: 140 }, historyLength: 2 } }, identity, 1);
    const imported = importV1([{ key: 'fantasy-draft-session-v1:sleeper:123', serialized: JSON.stringify(session) }]);
    const diagnostics: unknown[] = [];
    const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: diagnostic => { diagnostics.push(diagnostic); } });
    await database.importV1(imported);
    const workspace = createIndexedWorkspace({ database, identity, report: () => undefined });
    await workspace.send('markPlayerDrafted', 'p2', 'P2', 'WR', 1, 'Team 2', 2);
    const acknowledged = await workspace.readPersisted();
    await expect(workspace.commit('markPlayerDrafted', 'p99', 'P99', 'WR', 2, 'Team 3')).rejects.toThrow('Invalid IndexedDB session facts');
    expect(await workspace.readPersisted()).toEqual(acknowledged);
    expect(diagnostics).toMatchObject([{ phase: 'abort', error: { message: 'Invalid IndexedDB session facts' } }]);
    await workspace.send('addShortlistedPlayer', 'still-writable');
    expect((await workspace.readPersisted())?.shortlistedPlayerIds).toEqual(['still-writable']);
    workspace.dispose();
  });

  it('requires a normalized draft type in native IndexedDB records', () => {
    const session = sessionFromState(initialDraftState(identity), identity, 1);
    expect(() => decodeIndexedSession({ ...session, config: { ...session.config, draftType: undefined } })).toThrow('draftType');
  });

  it('does not revise schema-decoded facts for a rejected or duplicate command', async () => {
    const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: () => undefined });
    const workspace = createIndexedWorkspace({ database, identity, report: () => undefined });
    await workspace.send('addShortlistedPlayer', 'queued');
    const acknowledged = await workspace.readPersisted();
    await workspace.send('addShortlistedPlayer', 'queued');
    expect(await workspace.send('recordProvisionalPick', provisional(141))).toBe(false);
    await workspace.send('setSearchQuery', 'local');
    await workspace.refresh();
    expect(workspace.draft.getState().filter.searchQuery).toBe('local');
    expect(await workspace.readPersisted()).toEqual(acknowledged);
    workspace.dispose();
  });

  it.each([[1], [1, 1], [1, 99]])('rejects an invalid accepted prefix %j', (...historyPrefix) => {
    const state = initialDraftState(identity);
    const history = [provisional(1), provisional(3)].map(pick => ({ ...pick, source: 'manual' as const, timestamp: 0 }));
    const session = sessionFromState({ ...state, draftHistory: history,
      draftProgress: { anchor: { kind: 'carry', pickNumber: 1 }, historyLength: 2, historyPrefix } }, identity, 1);
    expect(() => decodeIndexedSession(session)).toThrow();
  });

  it('retains imported pick-order prefix semantics without sorting insertion history', () => {
    const state = initialDraftState(identity);
    const history = [provisional(3), provisional(1), provisional(2)].map(pick => ({ ...pick, source: 'manual' as const, timestamp: 0 }));
    const session = sessionFromState({ ...state, draftHistory: history, draftProgress: { anchor: { kind: 'carry', pickNumber: 1 }, historyLength: 1, historyPrefix: [1] } }, identity, 1);
    expect(session.currentPick).toBe(4);
    const decoded = decodeIndexedSession(session);
    expect(decoded.draftHistory.map(pick => pick.pickNumber)).toEqual([3, 1, 2]);
    expect(decoded.draftProgress.historyPrefix).toEqual([1]);
  });
});
