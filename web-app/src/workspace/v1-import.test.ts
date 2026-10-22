import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS, createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { deriveDraftCursor } from '@fantasy-draft/shared/draft';
import type { PersistedDraftSession } from '../stores/draftSessionStorage';
import type { DraftSessionChange } from '../stores/draftSessionUnconfirmedSaves';
import type { RecordedDraftPick } from '../stores/draft/types';
import { importV1, snapshotV1Storage, type RawV1Entry } from './v1-import';

function pick(pickNumber: number, playerId = `player-${pickNumber}`): RecordedDraftPick {
  return { pickNumber, playerId, playerName: playerId, position: 'WR', teamIndex: 0,
    teamName: 'Team 1', timestamp: 123, source: 'manual' };
}

function session(overrides: Partial<PersistedDraftSession> = {}): PersistedDraftSession {
  return {
    version: 1, revision: 1, lineage: ['base'], identity: { provider: 'sleeper', draftId: '123' },
    config: { totalTeams: 10, totalRounds: 14, draftType: 'snake', myPickPosition: 5, rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS },
    leagueSettings: createDefaultLeagueSettings(123), currentPick: 1,
    draftProgress: overrides.draftHistory?.length ? { anchor: { kind: 'carry', pickNumber: overrides.currentPick ?? 1 }, historyLength: overrides.draftHistory.length } : { anchor: { kind: 'start' }, historyLength: 0 }, draftHistory: [],
    shortlistedPlayerIds: [], preloadedKeepers: [], keepersInitialized: false,
    unresolvedProviderPicks: [], decisionLens: 'best-pick', manualContinuityBaselineAt: null,
    lastConfirmedSyncAt: null, lastConfirmedPickNumber: 0, ...overrides,
  };
}

function stored(value: unknown = session(), draftId = '123'): RawV1Entry {
  return { key: `fantasy-draft-session-v1:sleeper:${draftId}`, serialized: JSON.stringify(value) };
}

function change(overrides: Partial<DraftSessionChange> = {}): DraftSessionChange & { version: 1 } {
  return { version: 1, writeId: 'journal', baseWriteId: 'base', revision: 2,
    picks: [], fields: {}, queueAdded: [], queueRemoved: [], ...overrides };
}

function journal(value: unknown, tab = 'tab', draftId = '123'): RawV1Entry {
  return { key: `fantasy-draft-session-unconfirmed-v1:sleeper:${draftId}:${tab}`, serialized: JSON.stringify(value) };
}

function imported(entries: readonly RawV1Entry[]): PersistedDraftSession {
  const result = importV1(entries);
  expect(result.sessions).toHaveLength(1);
  const value = result.sessions[0];
  if (!value) throw new Error('Expected an imported session');
  return value;
}

const keeper = { playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 2, round: 4, isMyKeeper: false };

describe('v1 independent entry import', () => {
  it('keeps valid picks, keepers, queues and unresolved provider entries beside corruption', () => {
    const raw = stored({ ...session(), currentPick: 4, draftProgress: undefined,
      draftHistory: [pick(1), { ...pick(2), position: 'BROKEN' }, pick(3)],
      preloadedKeepers: [keeper, { ...keeper, playerId: 'invalid', teamIndex: 50 }],
      shortlistedPlayerIds: ['first', 123, 'last'],
      unresolvedProviderPicks: [{ pickNumber: 5, playerId: 'provider', playerName: 'Provider', nflTeam: null }, { pickNumber: -1 }],
    });
    const result = importV1([raw]);
    expect(result.sessions[0]?.draftHistory.map(row => row.pickNumber)).toEqual([1, 3]);
    expect(result.sessions[0]?.preloadedKeepers).toEqual([keeper]);
    expect(result.sessions[0]?.shortlistedPlayerIds).toEqual(['first', 'last']);
    expect(result.sessions[0]?.unresolvedProviderPicks.map(row => row.playerId)).toEqual(['provider']);
    expect(result.rejected).toHaveLength(4);
    expect(result.rejected.map(row => row.path)).toEqual([
      '$.draftHistory[1]', '$.preloadedKeepers[1]', '$.unresolvedProviderPicks[1]', '$.shortlistedPlayerIds[1]',
    ]);
    expect(result.rejected.every(row => row.key === raw.key && row.serialized === raw.serialized && row.reason.length > 0)).toBe(true);
    expect(result.source).toEqual([raw]);
  });

  it('reports each offending value once, even when it occurs twice', () => {
    const bad = { ...pick(2), playerId: null };
    const result = importV1([stored({ ...session(), draftProgress: undefined, draftHistory: [bad, bad, pick(1)] })]);
    expect(result.rejected).toHaveLength(1);
    expect(result.sessions[0]?.draftHistory).toEqual([pick(1)]);
  });

  it('retains the first valid occurrence of conflicting picks and keeper slots', () => {
    const result = importV1([stored({ ...session(), draftProgress: undefined, draftHistory: [pick(1), pick(1, 'duplicate-slot'), pick(2, 'player-1'), pick(3)],
      preloadedKeepers: [keeper, { ...keeper, playerId: 'duplicate-keeper-slot' }] })]);
    expect(result.sessions[0]?.draftHistory).toEqual([pick(1), pick(3)]);
    expect(result.sessions[0]?.preloadedKeepers).toEqual([keeper]);
    expect(result.rejected).toHaveLength(3);
  });

  it('isolates invalid sessions and rejects mismatched key identities', () => {
    const result = importV1([
      { key: 'fantasy-draft-session-v1:sleeper:broken', serialized: '{broken JSON' },
      stored(session(), 'mismatch'), stored(),
    ]);
    expect(result.sessions).toEqual([{ ...session(), draftProgress: { ...session().draftProgress, historyPrefix: [] } }]);
    expect(result.rejected).toHaveLength(2);
  });

  it('recovers valid arrays when another collection is malformed', () => {
    const result = importV1([stored({ ...session(), draftHistory: 'broken', shortlistedPlayerIds: ['kept'] })]);
    expect(result.sessions[0]?.draftHistory).toEqual([]);
    expect(result.sessions[0]?.shortlistedPlayerIds).toEqual(['kept']);
    expect(result.rejected).toHaveLength(1);
  });

  it('imports original sessions without progress, revision, lineage or draftType', () => {
    const value = session({ currentPick: 7, draftHistory: [pick(2), pick(1)] });
    const result = imported([stored({ ...value, revision: undefined, lineage: undefined, draftProgress: undefined,
      config: { ...value.config, draftType: undefined } })]);
    expect(result.revision).toBe(0);
    expect(result.lineage).toEqual([]);
    expect(result.config.draftType).toBe('snake');
    expect(result.draftHistory).toEqual(value.draftHistory);
    expect(result.draftProgress).toEqual({ anchor: { kind: 'carry', pickNumber: 7 }, historyLength: 2 });
  });
});

describe('v1 cursor history', () => {
  it('preserves insertion order and validates the progress prefix in pick order', () => {
    const value = session({ currentPick: 4, draftHistory: [pick(3), pick(1), pick(2)],
      draftProgress: { anchor: { kind: 'branch', pickNumber: 1 }, historyLength: 1 } });
    const result = importV1([stored(value)]);
    expect(result.rejected).toEqual([]);
    expect(result.sessions[0]?.draftHistory).toEqual(value.draftHistory);
    expect(result.sessions[0]?.draftProgress).toEqual({ ...value.draftProgress, historyPrefix: [1] });
    expect(deriveDraftCursor([...value.draftHistory].sort((a, b) => a.pickNumber - b.pickNumber), value.draftProgress)).toBe(4);
    expect(deriveDraftCursor(value.draftHistory, value.draftProgress)).toBe(3);
    const restored = result.sessions[0];
    if (!restored) throw new Error('Expected imported session');
    expect(deriveDraftCursor(restored.draftHistory, restored.draftProgress)).toBe(restored.currentPick);
  });

  it('translates a corrupted pick-order prefix while preserving the valid anchor', () => {
    const value = session({ currentPick: 4, draftHistory: [pick(3), pick(1), pick(2)],
      draftProgress: { anchor: { kind: 'branch', pickNumber: 1 }, historyLength: 1 } });
    const result = importV1([stored({ ...value, draftHistory: [pick(3), { ...pick(1), position: 'broken' }, pick(2)] })]);
    expect(result.rejected.map(row => row.path)).toEqual(['$.draftHistory[1]']);
    expect(result.sessions[0]?.draftProgress).toEqual({ anchor: value.draftProgress.anchor, historyLength: 0, historyPrefix: [] });
    expect(result.sessions[0]?.draftHistory).toEqual([pick(3), pick(2)]);
  });

  it('retains reserved keeper progress and diagnoses invalid progress with a saved-cursor fallback', () => {
    const value = session({ currentPick: 3, draftHistory: [pick(1)],
      draftProgress: { anchor: { kind: 'provider', nextPickNumber: 2, totalPicks: 140, keeperSlots: [2] }, historyLength: 1 } });
    expect(imported([stored(value)]).draftProgress).toEqual({ ...value.draftProgress, historyPrefix: [1] });
    const result = importV1([stored({ ...value, draftProgress: { anchor: { kind: 'start' }, historyLength: 1000 } })]);
    expect(result.rejected.map(row => row.path)).toEqual(['$.draftProgress']);
    expect(result.sessions[0]?.draftProgress).toEqual({ anchor: { kind: 'carry', pickNumber: 3 }, historyLength: 1 });
  });
});

describe('v1 journal import', () => {
  it('resolves retained journals and reversed dependency chains without writing storage', () => {
    const first = journal(change({ writeId: 'first', picks: [{ pickNumber: 1, before: null, after: pick(1) }], queueAdded: ['first'] }), 'first');
    const second = journal(change({ writeId: 'second', baseWriteId: 'first', revision: 3,
      picks: [{ pickNumber: 2, before: null, after: pick(2) }], queueAdded: ['second'],
      fields: { currentPick: { before: 1, after: 3 } } }), 'second');
    const source = [second, stored(), first];
    const result = importV1(source);
    expect(result.unresolved).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.sessions[0]?.draftHistory).toEqual([pick(1), pick(2)]);
    expect(result.sessions[0]?.shortlistedPlayerIds).toEqual(['first', 'second']);
    expect(result.sessions[0]?.lineage).toEqual(['base', 'first', 'second']);
    expect(result.sessions[0]?.currentPick).toBe(3);
    expect(result.source).toEqual(source);
    expect(importV1(source)).toEqual(result);
  });

  it('keeps missing-base journals, descendants and cycles with exact source bytes', () => {
    const missing = journal(change({ writeId: 'missing-child', baseWriteId: 'unknown', queueAdded: ['missing'] }), 'missing');
    const descendant = journal(change({ baseWriteId: 'missing-child', queueAdded: ['descendant'] }), 'descendant');
    const cycleA = journal(change({ writeId: 'a', baseWriteId: 'b' }), 'a');
    const cycleB = journal(change({ writeId: 'b', baseWriteId: 'a' }), 'b');
    const source = [missing, descendant, cycleA, cycleB];
    const result = importV1([stored(), ...source]);
    expect(result.unresolved.map(row => ({ key: row.key, serialized: row.serialized }))).toEqual(source);
    expect(result.sessions[0]?.shortlistedPlayerIds).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('retains standalone valid journals without inventing a base session', () => {
    const raw = journal(change({ baseWriteId: null, queueAdded: ['waiting'] }));
    const result = importV1([raw]);
    expect(result.sessions).toEqual([]);
    expect(result.unresolved).toEqual([{ ...raw, change: change({ baseWriteId: null, queueAdded: ['waiting'] }) }]);
  });

  it('does not replay a journal already represented by the session lineage', () => {
    const value = session({ lineage: ['base', 'journal'], shortlistedPlayerIds: ['later'] });
    const result = importV1([stored(value), journal(change({ queueAdded: ['obsolete'], fields: { currentPick: { before: 1, after: 20 } } }))]);
    expect(result.sessions).toEqual([{ ...value, draftProgress: { ...value.draftProgress, historyPrefix: [] } }]);
    expect(result.unresolved).toEqual([]);
  });

  it('keeps independent valid journal entries beside corrupt picks, queues and fields', () => {
    const raw = journal({ ...change(), picks: [
      { pickNumber: 1, before: null, after: { ...pick(1), position: 'broken' } },
      { pickNumber: 2, before: null, after: pick(2) },
    ], queueAdded: ['first', null, 'last'], fields: { decisionLens: { before: 'best-pick', after: 'broken' } } });
    const result = importV1([stored(), raw]);
    expect(result.sessions[0]?.draftHistory).toEqual([pick(2)]);
    expect(result.sessions[0]?.shortlistedPlayerIds).toEqual(['first', 'last']);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.every(row => row.serialized === raw.serialized)).toBe(true);
    expect(result.sessions[0]?.lineage).toEqual(['base']);
  });

  it('preserves the original pick when a dependent move member is corrupt', () => {
    const raw = journal({ ...change(), picks: [
      { pickNumber: 1, before: pick(1, 'moved'), after: null },
      { pickNumber: 2, before: null, after: { ...pick(2, 'moved'), position: 'broken' } },
      { pickNumber: 3, before: null, after: pick(3) },
    ] });
    const result = importV1([stored(session({ draftHistory: [pick(1, 'moved')] })), raw]);
    expect(result.sessions[0]?.draftHistory).toEqual([pick(1, 'moved'), pick(3)]);
    expect(result.rejected).toHaveLength(1);
  });

  it('blocks all pick removals when a corrupt member has no recoverable dependency identity', () => {
    const raw = journal({ ...change(), picks: [{ pickNumber: 1, before: pick(1), after: null }, null] });
    expect(imported([stored(session({ draftHistory: [pick(1)] })), raw]).draftHistory).toEqual([pick(1)]);
  });

  it('retains the original pick when a corrupt destination omits its player identity', () => {
    const raw = journal({ ...change(), picks: [
      { pickNumber: 1, before: pick(1), after: null },
      { pickNumber: 2, before: null, after: { pickNumber: 2, position: 'broken' } },
    ] });
    expect(imported([stored(session({ draftHistory: [pick(1)] })), raw]).draftHistory).toEqual([pick(1)]);
  });

  it('applies valid moves atomically and retains conflicts as unresolved', () => {
    const move = journal(change({ picks: [
      { pickNumber: 1, before: pick(1, 'moved'), after: null },
      { pickNumber: 2, before: null, after: pick(2, 'moved') },
      { pickNumber: 3, before: null, after: pick(3) },
    ] }));
    expect(imported([stored(session({ draftHistory: [pick(1, 'moved')] })), move]).draftHistory).toEqual([pick(2, 'moved'), pick(3)]);
    const result = importV1([stored(session({ draftHistory: [pick(1, 'moved'), pick(2, 'occupied')] })), move]);
    expect(result.sessions[0]?.draftHistory).toEqual([pick(1, 'moved'), pick(2, 'occupied'), pick(3)]);
    expect(result.unresolved.map(row => row.key)).toEqual([move.key]);
    expect(result.sessions[0]?.lineage).toEqual(['base']);
  });

  it('does not resolve descendants of a partially rejected base', () => {
    const base = journal({ ...change({ writeId: 'partial' }), queueAdded: ['kept', null] }, 'base');
    const child = journal(change({ baseWriteId: 'partial', queueAdded: ['blocked'] }), 'child');
    const result = importV1([stored(), base, child]);
    expect(result.sessions[0]?.shortlistedPlayerIds).toEqual(['kept']);
    expect(result.unresolved.map(row => row.key)).toEqual([child.key]);
  });

  it('uses each journal key identity and isolates an invalid journal record', () => {
    const result = importV1([stored(), journal({ version: 2 }), journal(change({ baseWriteId: null }), 'other', '456')]);
    expect(result.sessions).toEqual([{ ...session(), draftProgress: { ...session().draftProgress, historyPrefix: [] } }]);
    expect(result.rejected).toHaveLength(1);
    expect(result.unresolved[0]?.key).toContain(':456:');
  });

  it('keeps progress on queue-only recovery and imports carry after pick changes', () => {
    const value = session({ currentPick: 96, draftHistory: [pick(1)],
      draftProgress: { anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 1 } });
    expect(imported([stored(value), journal(change({ queueAdded: ['queued'] }))]).draftProgress).toEqual({ ...value.draftProgress, historyPrefix: [1] });
    expect(imported([stored(value), journal(change({ picks: [{ pickNumber: 2, before: null, after: pick(2) }] }))]).draftProgress)
      .toEqual({ anchor: { kind: 'carry', pickNumber: 96 }, historyLength: 2 });
  });
});

describe('v1 storage snapshot', () => {
  it('copies only raw v1 session and journal strings through a read-only interface', () => {
    const values = new Map([['unrelated', 'ignored'], [stored().key, stored().serialized], [journal(change()).key, journal(change()).serialized]]);
    const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null };
    const snapshot = snapshotV1Storage(storage);
    expect(snapshot).toEqual([stored(), journal(change())]);
    expect(importV1(snapshot).source).toEqual(snapshot);
    expect(values.size).toBe(3);
  });

  it.each(['length', 'key', 'getItem'] as const)('propagates %s exceptions', operation => {
    const storage = { get length() { if (operation === 'length') throw new Error('denied'); return 1; },
      key: (_index: number) => { if (operation === 'key') throw new Error('denied'); return stored().key; },
      getItem: (_key: string) => { if (operation === 'getItem') throw new Error('denied'); return stored().serialized; } };
    expect(() => snapshotV1Storage(storage)).toThrow('denied');
  });

  it('fails if an enumerated record disappears during capture', () => {
    expect(() => snapshotV1Storage({ length: 1, key: () => stored().key, getItem: () => null })).toThrow('Storage changed');
  });
});
