import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { deriveDraftCursor } from '@fantasy-draft/shared/draft';
import { createDraftStore } from '@/stores/draftStore';
import type { DraftActions, DraftState, ProvisionalPickInput } from '@/stores/draft/types';
import { initialDraftState, reduceDraftCommand, type DraftCommand } from './draft-reducer';

const identity = { provider: 'sleeper', draftId: '123' } as const;
const now = Date.parse('2026-08-10T12:00:00Z');
const stores: ReturnType<typeof createDraftStore>[] = [];

function dataState(state: DraftState) {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== 'function'));
}

type OracleCommand = Exclude<DraftCommand, ['advanceSyncFreshness', number]>;

function applyToOracle(actions: DraftActions, command: OracleCommand, queue: readonly string[]): unknown {
  switch (command[0]) {
    case 'setLiveDraftSession': { actions.setLiveDraftSession(command[1]); return; }
    case 'setSessionMode': { actions.setSessionMode(command[1]); return; }
    case 'enterManualContinuity': { actions.enterManualContinuity(command[1]); return; }
    case 'setConfig': { actions.setConfig(command[1]); return; }
    case 'applyLeagueSettings': { actions.applyLeagueSettings(command[1]); return; }
    case 'setRosterRequirements': { actions.setRosterRequirements(command[1]); return; }
    case 'setMockSettings': { actions.setMockSettings(command[1]); return; }
    case 'setMockAutoAdvancePaused': { actions.setMockAutoAdvancePaused(command[1]); return; }
    case 'setMockSettingsOpen': { actions.setMockSettingsOpen(command[1]); return; }
    case 'markPlayerDrafted': {
      const [, ...args] = command;
      actions.markPlayerDrafted(...args); return;
    }
    case 'recordProvisionalPick': return actions.recordProvisionalPick(command[1]);
    case 'correctProvisionalPick': return actions.correctProvisionalPick(command[1], command[2]);
    case 'removeProvisionalPick': return actions.removeProvisionalPick(command[1]);
    case 'reconcileSyncedPicks': {
      const [, ...args] = command;
      return actions.reconcileSyncedPicks(...args);
    }
    case 'preloadKeepers': { actions.preloadKeepers(command[1], command[2]); return; }
    case 'consumeKeeperAtCurrentPick': { actions.consumeKeeperAtCurrentPick(); return; }
    case 'undoLastPick': { actions.undoLastPick(); return; }
    case 'branchFromPick': { actions.branchFromPick(command[1]); return; }
    case 'resetDraft': { actions.resetDraft(); return; }
    case 'setMockSurvivalProbabilities': { actions.setMockSurvivalProbabilities(command[1]); return; }
    case 'togglePlayerShortlisted': { actions.togglePlayerShortlisted(command[1]); return; }
    case 'removePlayerFromShortlist': { actions.removePlayerFromShortlist(command[1]); return; }
    case 'moveShortlistedPlayer': { actions.moveShortlistedPlayer(command[1], command[2]); return; }
    case 'setPlayerShortlisted':
      if (command[2]) { if (!queue.includes(command[1])) actions.togglePlayerShortlisted(command[1]); }
      else actions.removePlayerFromShortlist(command[1]);
      return;
    case 'addShortlistedPlayer':
      if (!queue.includes(command[1])) actions.togglePlayerShortlisted(command[1]);
      return;
    case 'moveShortlistedPlayerTo':
      { actions.moveShortlistedPlayer(command[1], command[2] - queue.indexOf(command[1])); return; }
    case 'setDecisionLens': { actions.setDecisionLens(command[1]); return; }
    case 'setPositionFilter': { actions.setPositionFilter(command[1]); return; }
    case 'setSearchQuery': { actions.setSearchQuery(command[1]); return; }
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

function createReplay(seed: DraftState = initialDraftState(identity)) {
  const oracle = createDraftStore({ storage: null });
  stores.push(oracle);
  let state = structuredClone(seed);
  oracle.setState(structuredClone(seed));
  expect(dataState(oracle.getState())).toEqual(state);
  return {
    state: () => state,
    cursor: () => deriveDraftCursor(state.draftHistory, state.draftProgress),
    send(command: OracleCommand) {
      const previous = structuredClone(state);
      const reduced = reduceDraftCommand(state, structuredClone(command));
      const actual = oracle.getState();
      const expectedResult = applyToOracle(actual, structuredClone(command), actual.shortlistedPlayerIds);
      const label = JSON.stringify(command);
      expect(state, `input mutation after ${label}`).toEqual(previous);
      expect(reduced.result, `result after ${label}`).toEqual(expectedResult);
      expect(dataState(reduced.state), `state after ${label}`).toEqual(dataState(oracle.getState()));
      state = reduced.state;
      return reduced.result;
    },
  };
}

function pick(pickNumber: number, playerId = `p${pickNumber}`): ProvisionalPickInput {
  return { pickNumber, playerId, playerName: playerId, position: 'WR', teamIndex: pickNumber - 1, teamName: `Team ${pickNumber}` };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
});

describe('pure draft reducer parity with the production null-storage store', () => {
  it('replays configuration, tab-local controls, and relative and absolute queue commands', () => {
    const replay = createReplay();
    const settings = { ...createDefaultLeagueSettings(), totalTeams: 4, leagueId: 'parity', fingerprint: 'parity' };
    const requirements = { ...settings.rosterRequirements, BENCH: { spots: 3 } };
    const commands: OracleCommand[] = [
      ['setLiveDraftSession', identity],
      ['setPlayerShortlisted', 'absolute', true], ['setPlayerShortlisted', 'absolute', true],
      ['setPlayerShortlisted', 'absolute', false], ['setPlayerShortlisted', 'absolute', false],
      ['setConfig', { totalTeams: 6, totalRounds: 4, myPickPosition: 6, draftType: 'linear' }],
      ['applyLeagueSettings', settings], ['applyLeagueSettings', settings],
      ['setRosterRequirements', requirements],
      ['setConfig', { totalTeams: Number.NaN }],
      ['setMockSettings', { randomness: 2, seed: -1, survivalIterations: 1, cpuPickPace: 'instant' }],
      ['setMockAutoAdvancePaused', true], ['setMockSettingsOpen', true],
      ['setMockSurvivalProbabilities', { waiting: 0.4 }],
      ['setDecisionLens', 'best-player'], ['setPositionFilter', 'RB'], ['setSearchQuery', 'waiting'],
      ['addShortlistedPlayer', 'a'], ['addShortlistedPlayer', 'a'],
      ['togglePlayerShortlisted', 'b'], ['addShortlistedPlayer', 'c'],
      ['moveShortlistedPlayer', 'c', -1], ['moveShortlistedPlayerTo', 'b', 0],
      ['moveShortlistedPlayerTo', 'missing', 0], ['moveShortlistedPlayer', 'a', 99],
      ['togglePlayerShortlisted', 'c'], ['removePlayerFromShortlist', 'missing'],
      ['removePlayerFromShortlist', 'a'],
    ];
    for (const command of commands) replay.send(command);
    expect(replay.state()).toMatchObject({
      config: { totalTeams: 4, totalRounds: 4, myPickPosition: 4, draftType: 'linear', rosterRequirements: requirements },
      mockSettings: { randomness: 1, seed: 0, survivalIterations: 25, cpuPickPace: 'instant' },
      mockAutoAdvance: { paused: true, settingsOpen: true },
      mockSurvivalProbabilities: { waiting: 0.4 },
      decisionLens: 'best-player', filter: { position: 'RB', searchQuery: 'waiting' },
      shortlistedPlayerIds: ['b'],
    });
  });

  it('replays provisional acceptance, rejection, correction, removal, and queue restoration', () => {
    const replay = createReplay();
    for (const id of ['waiting', 'p1', 'replacement', 'p3']) replay.send(['addShortlistedPlayer', id]);
    expect(replay.send(['recordProvisionalPick', pick(3)])).toBe(true);
    expect(replay.send(['recordProvisionalPick', pick(1)])).toBe(true);
    expect(replay.cursor()).toBe(2);
    expect(replay.send(['recordProvisionalPick', pick(1, 'occupied')])).toBe(false);
    expect(replay.send(['recordProvisionalPick', pick(2, 'p1')])).toBe(false);
    expect(replay.send(['recordProvisionalPick', { ...pick(2), teamIndex: 0 }])).toBe(false);
    expect(replay.send(['recordProvisionalPick', pick(999)])).toBe(false);
    expect(replay.send(['correctProvisionalPick', 1, pick(1)])).toBe(false);
    expect(replay.send(['correctProvisionalPick', 1, pick(3, 'replacement')])).toBe(false);
    vi.setSystemTime(now + 1000);
    expect(replay.send(['correctProvisionalPick', 1, pick(2, 'replacement')])).toBe(true);
    expect(replay.state().draftHistory[0]).toMatchObject({
      pickNumber: 2, playerId: 'replacement', timestamp: now, provisionalRevision: 1, provisionalUpdatedAt: now + 1000,
    });
    expect(replay.state().shortlistedPlayerIds).toEqual(['waiting', 'p1']);
    expect(replay.cursor()).toBe(1);
    expect(replay.send(['removeProvisionalPick', 2])).toBe(true);
    expect(replay.send(['removeProvisionalPick', 2])).toBe(false);
    expect(replay.state().shortlistedPlayerIds).toEqual(['waiting', 'p1', 'replacement']);
    replay.send(['markPlayerDrafted', 'manual', 'Manual', 'RB', 0, 'Team 1', 1]);
    expect(replay.send(['removeProvisionalPick', 1])).toBe(false);
    replay.send(['setSessionMode', 'setup']);
    expect(replay.send(['recordProvisionalPick', pick(2)])).toBe(false);
    replay.send(['setSessionMode', 'live']);
    expect(replay.send(['recordProvisionalPick', pick(2)])).toBe(true);
  });

  it.each(['snake', 'linear'] as const)('replays %s keepers, consumption, undo, branch, and reset', draftType => {
    const replay = createReplay();
    replay.send(['setConfig', { totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType }]);
    const keeper = { playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 3, round: 1, isMyKeeper: false } as const;
    replay.send(['addShortlistedPlayer', 'keeper']);
    replay.send(['preloadKeepers', [keeper], false]);
    expect(replay.state().keepersInitialized).toBe(false);
    replay.send(['preloadKeepers', [keeper]]);
    expect(replay.state().keepersInitialized).toBe(true);
    expect(replay.state().shortlistedPlayerIds).toEqual([]);
    expect(replay.send(['recordProvisionalPick', pick(4)])).toBe(false);
    replay.send(['consumeKeeperAtCurrentPick']);
    expect(replay.state().draftHistory).toEqual([]);
    replay.send(['branchFromPick', 4]);
    replay.send(['consumeKeeperAtCurrentPick']);
    expect(replay.state().draftHistory[0]).toMatchObject({ playerId: 'keeper', pickNumber: 4, source: 'keeper', timestamp: now });
    expect(replay.cursor()).toBe(5);
    replay.send(['undoLastPick']);
    expect(replay.cursor()).toBe(4);
    replay.send(['consumeKeeperAtCurrentPick']);
    replay.send(['branchFromPick', 2]);
    replay.send(['addShortlistedPlayer', 'manual']);
    replay.send(['markPlayerDrafted', 'manual', 'Manual', 'WR', 1, 'Team 2']);
    expect(replay.state().mockAutoAdvance.paused).toBe(false);
    replay.send(['undoLastPick']);
    expect(replay.state().shortlistedPlayerIds).toEqual(['manual']);
    expect(replay.state().mockAutoAdvance.paused).toBe(true);
    replay.send(['setMockSurvivalProbabilities', { manual: 0.7 }]);
    replay.send(['resetDraft']);
    expect(replay.cursor()).toBe(1);
    expect(replay.state()).toMatchObject({ draftHistory: [], shortlistedPlayerIds: [], mockSurvivalProbabilities: {}, mockAutoAdvance: { paused: false } });
    expect(replay.state().preloadedKeepers).toHaveLength(1);
    replay.send(['preloadKeepers', [keeper, { ...keeper, playerId: 'conflicting' }]]);
    expect(replay.state().keepersInitialized).toBe(false);
    expect(replay.state().preloadedKeepers).toEqual([]);
  });

  it('replays manual continuity and provider confirmations, corrections, removals, and unresolved identities', () => {
    const replay = createReplay();
    for (const id of ['p1', 'p2', 'p3', 'provider']) replay.send(['addShortlistedPlayer', id]);
    replay.send(['recordProvisionalPick', pick(1)]);
    replay.send(['recordProvisionalPick', pick(2)]);
    replay.send(['recordProvisionalPick', pick(3)]);
    replay.send(['enterManualContinuity', -1]);
    expect(replay.state().manualContinuityBaselineAt).toBeNull();
    replay.send(['enterManualContinuity', now]);
    const incoming = [{ ...pick(1), isMyPick: false }, { ...pick(2, 'provider'), isMyPick: false }];
    const unresolved = [{ pickNumber: 4, playerId: 'unknown', playerName: 'Unknown', nflTeam: null }];
    expect(replay.send(['reconcileSyncedPicks', incoming, 5, unresolved, now])).toMatchObject({ changed: false });
    expect(replay.send(['reconcileSyncedPicks', [], 1])).toMatchObject({ changed: false });
    expect(replay.state().draftHistory).toHaveLength(3);
    vi.setSystemTime(now + 2000);
    expect(replay.send(['reconcileSyncedPicks', incoming, 5, unresolved, now + 1000])).toMatchObject({
      changed: true,
      confirmations: [{ pickNumber: 1, playerId: 'p1' }],
      corrections: [{ pickNumber: 2, previous: { playerId: 'p2' }, provider: { playerId: 'provider' } }],
      removals: [{ pickNumber: 3, playerId: 'p3', source: 'provisional' }],
      unresolvedIdentities: unresolved,
    });
    expect(replay.cursor()).toBe(5);
    expect(replay.state()).toMatchObject({ manualContinuityBaselineAt: null, lastConfirmedSyncAt: now + 1000, lastConfirmedPickNumber: 4, shortlistedPlayerIds: ['p3', 'p2'] });
    expect(replay.send(['reconcileSyncedPicks', incoming, 5, unresolved, now + 1000])).toMatchObject({ changed: false });
    expect(replay.send(['reconcileSyncedPicks', [], 1, [], now])).toMatchObject({ changed: false });
    replay.send(['resetDraft']);
    expect(replay.state()).toMatchObject({ unresolvedProviderPicks: [], lastConfirmedSyncAt: null, lastConfirmedPickNumber: 0 });
    replay.send(['setMockAutoAdvancePaused', true]);
    replay.send(['setSessionMode', 'mock']);
    replay.send(['enterManualContinuity', now]);
    expect(replay.state()).toMatchObject({ sessionMode: 'mock', liveSession: null, manualContinuityBaselineAt: null, mockAutoAdvance: { paused: false } });
  });

  it('preserves insertion order and frozen accepted-prefix progress during later appends', () => {
    const seed = initialDraftState(identity);
    seed.draftHistory = [3, 1].map(slot => ({ ...pick(slot), source: 'manual' as const, timestamp: now }));
    seed.draftProgress = { anchor: { kind: 'first-open', keeperSlots: [], totalPicks: 140 }, historyLength: 2, historyPrefix: [1, 3] };
    const replay = createReplay(seed);
    expect(replay.cursor()).toBe(2);
    replay.send(['markPlayerDrafted', 'p2', 'p2', 'WR', 1, 'Team 2', 2]);
    expect(replay.state().draftHistory.map(entry => entry.pickNumber)).toEqual([3, 1, 2]);
    expect(replay.cursor()).toBe(3);
    replay.send(['addShortlistedPlayer', 'waiting']);
    replay.send(['undoLastPick']);
    expect(replay.cursor()).toBe(2);
    replay.send(['branchFromPick', 2]);
    expect(replay.state().draftHistory.map(entry => entry.pickNumber)).toEqual([1]);
    replay.send(['recordProvisionalPick', pick(2)]);
    expect(replay.cursor()).toBe(3);
  });

  it('imports and executes the pure reducer without loading the catalog barrel', async () => {
    vi.resetModules();
    vi.doMock('@fantasy-draft/shared/catalog', () => { throw new Error('Pure reducer imported the catalog boundary'); });
    try {
      const pure = await import('./draft-reducer');
      let state = pure.initialDraftState(identity);
      const commands: OracleCommand[] = [
        ['setConfig', { totalTeams: 4 }], ['addShortlistedPlayer', 'p1'],
        ['recordProvisionalPick', pick(1)], ['enterManualContinuity', now],
        ['reconcileSyncedPicks', [{ ...pick(1), isMyPick: false }], 2, [], now + 1],
      ];
      for (const command of commands) state = pure.reduceDraftCommand(state, command).state;
      expect(state.draftHistory).toMatchObject([{ playerId: 'p1', source: 'sync' }]);
      expect(state.lastConfirmedSyncAt).toBe(now + 1);
    } finally {
      vi.doUnmock('@fantasy-draft/shared/catalog');
      vi.resetModules();
    }
  });
});


it('advances freshness monotonically without changing draft facts or the manual boundary', () => {
  const previous = { ...initialDraftState(identity), lastConfirmedSyncAt: 200, manualContinuityBaselineAt: 100 };
  expect(reduceDraftCommand(previous, ['advanceSyncFreshness', 150]).state).toBe(previous);
  const advanced = reduceDraftCommand(previous, ['advanceSyncFreshness', 300]);
  expect(advanced.state).toEqual({ ...previous, lastConfirmedSyncAt: 300 });
  expect(previous.lastConfirmedSyncAt).toBe(200);
  expect(() => reduceDraftCommand(previous, ['advanceSyncFreshness', Number.NaN])).toThrow('Invalid sync freshness');
});
