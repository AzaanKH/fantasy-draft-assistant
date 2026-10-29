import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS, createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { deriveDraftCursor } from '@fantasy-draft/shared/draft';
import type { PersistedDraftSession } from '../stores/draftSessionStorage';
import type { DraftSessionChange } from '../stores/draftSessionUnconfirmedSaves';
import type { RecordedDraftPick } from '../stores/draft/types';
import { importSourceDigest } from './indexed-db';
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
    const raw = stored({ ...session(), draftProgress: undefined, draftHistory: [pick(1), pick(1, 'duplicate-slot'), pick(2, 'player-1'), pick(3)],
      preloadedKeepers: [keeper, { ...keeper, playerId: 'duplicate-keeper-slot' }] });
    const result = importV1([raw]);
    expect(result.sessions[0]?.draftHistory).toEqual([pick(1), pick(3)]);
    expect(result.sessions[0]?.preloadedKeepers).toEqual([keeper]);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.every(row => row.serialized === raw.serialized)).toBe(true);
    expect(importV1([raw])).toEqual(result);
  });

  it.each([
    { reason: 'invalid entry', supply: [keeper, { ...keeper, playerId: 'invalid', position: 'BROKEN' }], accepted: [keeper] },
    { reason: 'out-of-bounds entry', supply: [keeper, { ...keeper, playerId: 'invalid', teamIndex: 50 }], accepted: [keeper] },
    { reason: 'duplicate slot', supply: [keeper, { ...keeper, playerId: 'duplicate-slot' }], accepted: [keeper] },
    { reason: 'duplicate player', supply: [keeper, { ...keeper, round: 5 }], accepted: [keeper] },
    { reason: 'malformed collection', supply: null, accepted: [] },
  ])('retains valid keepers but leaves the supply incomplete after a rejected $reason', ({ supply, accepted }) => {
    const raw = stored({ ...session(), keepersInitialized: true, preloadedKeepers: supply });
    const result = importV1([raw]);
    expect(result.sessions[0]?.preloadedKeepers).toEqual(accepted);
    expect(result.sessions[0]?.keepersInitialized).toBe(false);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ key: raw.key, serialized: raw.serialized });
    expect(result.source).toEqual([raw]);
  });

  it.each([true, false])('preserves keepersInitialized=%s for a complete valid keeper supply', keepersInitialized => {
    const result = importV1([stored({ ...session(), keepersInitialized, preloadedKeepers: [keeper] })]);
    expect(result.sessions[0]?.preloadedKeepers).toEqual([keeper]);
    expect(result.sessions[0]?.keepersInitialized).toBe(keepersInitialized);
    expect(result.rejected).toEqual([]);
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

  it.each([
    { draftType: undefined, expected: 'snake', teamIndex: 9 },
    { draftType: 'linear', expected: 'linear', teamIndex: 0 },
  ])('normalizes legacy draftType=$draftType before validating later-round provisional picks', ({ draftType, expected, teamIndex }) => {
    const value = session();
    const provisional = { ...pick(11), source: 'provisional', teamIndex };
    const result = importV1([stored({ ...value, currentPick: 12, draftProgress: undefined,
      config: { ...value.config, draftType }, draftHistory: [provisional] })]);
    expect(result.sessions[0]?.config.draftType).toBe(expected);
    expect(result.sessions[0]?.draftHistory).toEqual([provisional]);
    expect(result.rejected).toEqual([]);
  });

  it('keeps the import digest earlier releases recorded for every legacy field combination', async () => {
    await expect(legacyImportDigests()).resolves.toEqual(LEGACY_IMPORT_DIGESTS);
  });
});

const LEGACY_FIELDS = ['draftType', 'revision', 'lineage', 'draftProgress'] as const;

const LEGACY_IMPORT_DIGESTS: Record<string, string> = {
  'none': 'dc07a9715802a2d151e7ce5339797ea1ac48874497eb36ea7fdd834b9b8df5ba',
  'draftType': '3ccb6ae7fdd5241d96edc85ea99981e5508586f9af838e050c3324b74972cd73',
  'revision': 'a43834a6f2610f1402a2157416b23209a46afe05f57d1deb0cbf999e7abf0813',
  'draftType+revision': '99a1478c3bc5c6a3c08bc10ff7ac472ff0d879aa5a245cf3406b2325a605c21d',
  'lineage': 'aa420b1b7bcb6563720cc295545eb27bc01914014aaabd67aad2071a4f972e82',
  'draftType+lineage': '713cdcccbee352bca4e8df059e01341d644883b4320f1ec5f91aa09997bccdb1',
  'revision+lineage': '29c7cd2d5f3c68ee7eff77d4c6574ad159cdd94e50793e5bbd278ee6fc6d4a5b',
  'draftType+revision+lineage': '57ebf8203051ba6956e36a5e964e5266a393293ddfb8f99597a1be89d27196d1',
  'draftProgress': '93083af84b4f91788e33ac00b1181fca1bea5c0aa6b42ed1e41279c63e42502a',
  'draftType+draftProgress': '906db23152a3ec66b6b495b064b44c6c1581671d23948cb99c0ec2651eb56481',
  'revision+draftProgress': '93e174188d5e7697dc96019c77f474740261f53f13461e55572ea21c334bf7f6',
  'draftType+revision+draftProgress': '488f4bc50f8de7246eaaf5efcabb898490a4d1cf238ae40ec3c3e20cdda8b4e7',
  'lineage+draftProgress': '51456f336d7582b5402889122ed8c2cd5238342b3bc0852538cab1489bdb7b1a',
  'draftType+lineage+draftProgress': '25987e1a715d045ab1b03fec386f110cd1f60e469a976644da3280239a057b21',
  'revision+lineage+draftProgress': '978ee3c7b3e56f45d8c2d85dcb0d1bdca2bfb9f584ca3c80d515cf9e88b60563',
  'draftType+revision+lineage+draftProgress': '2396511736af22bd096b731584b61f531f97ca8678168c5b47b08fa56e964b78',
};

async function legacyImportDigests(): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (let mask = 0; mask < 1 << LEGACY_FIELDS.length; mask++) {
    const present = LEGACY_FIELDS.filter((_, index) => mask & 1 << index);
    const value: Record<string, unknown> = { ...session({ currentPick: 7, draftHistory: [pick(2), pick(1)] }) };
    const config: Record<string, unknown> = { ...session().config };
    if (!present.includes('draftType')) config.draftType = undefined;
    value.config = config;
    for (const field of ['revision', 'lineage', 'draftProgress'] as const) if (!present.includes(field)) value[field] = undefined;
    const result = importV1([stored(value)]);
    const imported = result.sessions[0];
    if (!imported) throw new Error('Expected an imported session');
    digests[present.join('+') || 'none'] = await importSourceDigest(result.source, imported);
  }
  return digests;
}

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

  it('blocks all pick changes when a corrupt member has no recoverable dependency identity', () => {
    const raw = journal({ ...change(), picks: [
      { pickNumber: 1, before: pick(1), after: null }, null,
      { pickNumber: 3, before: null, after: pick(3) },
    ], queueAdded: ['queued'] });
    const result = imported([stored(session({ draftHistory: [pick(1)] })), raw]);
    expect(result.draftHistory).toEqual([pick(1)]);
    expect(result.shortlistedPlayerIds).toEqual(['queued']);
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
