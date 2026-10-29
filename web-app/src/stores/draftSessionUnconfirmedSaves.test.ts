import { describe, expect, it } from 'vitest';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { defaultConfig } from './draft/state';
import type { RecordedDraftPick } from './draft/types';
import { applyDraftSessionChange, computeDraftSessionChange } from './draftSessionUnconfirmedSaves';
import type { PersistedDraftSession } from './draftSessionStorage';

function pick(pickNumber: number, playerId: string): RecordedDraftPick {
  return {
    pickNumber, playerId, playerName: playerId, position: 'WR', teamIndex: pickNumber - 1,
    teamName: `Team ${String(pickNumber)}`, timestamp: 100, source: 'provisional',
  };
}

function session(overrides: Partial<PersistedDraftSession> = {}): PersistedDraftSession {
  return {
    version: 1, draftProgress: { anchor: { kind: 'start' }, historyLength: 0 }, revision: 1, lineage: ['base'], identity: { provider: 'sleeper', draftId: '123' },
    config: defaultConfig, leagueSettings: createDefaultLeagueSettings(), currentPick: 1, draftHistory: [],
    shortlistedPlayerIds: [], preloadedKeepers: [], keepersInitialized: false, unresolvedProviderPicks: [],
    decisionLens: 'best-pick', manualContinuityBaselineAt: null, lastConfirmedSyncAt: null,
    lastConfirmedPickNumber: 0, ...overrides,
  };
}

describe('merging an overwritten save', () => {
  it('applies picks, queue changes, and fields the newer session left alone', () => {
    const base = session({ shortlistedPlayerIds: ['kept', 'drafted'], draftHistory: [pick(1, 'first')], currentPick: 2 });
    const overwritten = session({
      shortlistedPlayerIds: ['kept', 'added'], draftHistory: [pick(1, 'first'), pick(2, 'drafted')],
      currentPick: 3, decisionLens: 'best-player',
    });
    const newer = session({ shortlistedPlayerIds: ['kept', 'drafted', 'other'], draftHistory: [pick(1, 'first')], currentPick: 2 });

    const merged = applyDraftSessionChange(newer, computeDraftSessionChange(base, overwritten, 'lost'));

    expect(merged.draftHistory.map((entry) => entry.playerId)).toEqual(['first', 'drafted']);
    expect(merged.shortlistedPlayerIds).toEqual(['kept', 'other', 'added']);
    expect(merged.currentPick).toBe(3);
    expect(merged.decisionLens).toBe('best-player');
  });

  it('keeps the newer session where both saves changed the same pick, player, or field', () => {
    const base = session({ draftHistory: [pick(1, 'first')], currentPick: 2 });
    const overwritten = session({
      draftHistory: [pick(1, 'first'), pick(2, 'mine'), pick(3, 'shared')], currentPick: 4, decisionLens: 'best-player',
    });
    const newer = session({
      draftHistory: [pick(1, 'first'), pick(2, 'theirs'), pick(4, 'shared')], currentPick: 5,
      lastConfirmedPickNumber: 1,
    });

    const merged = applyDraftSessionChange(newer, computeDraftSessionChange(base, overwritten, 'lost'));

    expect(merged.draftHistory.map((entry) => entry.playerId)).toEqual(['first', 'theirs', 'shared']);
    expect(merged.draftHistory.find((entry) => entry.playerId === 'shared')?.pickNumber).toBe(4);
    expect(merged.currentPick).toBe(5);
    expect(merged.decisionLens).toBe('best-player');
    expect(merged.lastConfirmedPickNumber).toBe(1);
  });

  it('applies removals and moves without restoring the removed pick', () => {
    const base = session({ draftHistory: [pick(1, 'first'), pick(2, 'moved')] });
    const overwritten = session({ draftHistory: [pick(3, 'moved')] });
    const merged = applyDraftSessionChange(base, computeDraftSessionChange(base, overwritten, 'lost'));
    expect(merged.draftHistory.map((entry) => [entry.pickNumber, entry.playerId])).toEqual([[3, 'moved']]);
  });

  it('keeps a moved pick at its original slot when the newer session took the destination', () => {
    const base = session({ draftHistory: [pick(1, 'moved')] });
    const overwritten = session({ draftHistory: [pick(2, 'moved')] });
    const newer = session({ draftHistory: [pick(1, 'moved'), pick(2, 'other')] });
    const merged = applyDraftSessionChange(newer, computeDraftSessionChange(base, overwritten, 'lost'));
    expect(merged.draftHistory.map((entry) => [entry.pickNumber, entry.playerId])).toEqual([[1, 'moved'], [2, 'other']]);
  });

  it('applies a move and an unrelated pick independently', () => {
    const base = session({ draftHistory: [pick(1, 'moved')] });
    const overwritten = session({ draftHistory: [pick(2, 'moved'), pick(3, 'added')] });
    const newer = session({ draftHistory: [pick(1, 'moved'), pick(2, 'other')] });
    const merged = applyDraftSessionChange(newer, computeDraftSessionChange(base, overwritten, 'lost'));
    expect(merged.draftHistory.map((entry) => [entry.pickNumber, entry.playerId]))
      .toEqual([[1, 'moved'], [2, 'other'], [3, 'added']]);
  });
});

it('keeps session progress when a recovered journal changes only the queue', () => {
  const base = session({ currentPick: 96, draftProgress: { anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 0 } });
  const next = { ...base, shortlistedPlayerIds: ['waiting'] };
  const change = computeDraftSessionChange(base, next, 'queue-only');
  expect(change.fields).not.toHaveProperty('draftProgress');
  expect(applyDraftSessionChange(base, change).draftProgress).toEqual(base.draftProgress);
});

it('imports carry when recovered picks change the accepted prefix without moving the cursor', () => {
  const base = session({ currentPick: 96, draftHistory: [pick(1, 'first')],
    draftProgress: { anchor: { kind: 'branch', pickNumber: 96 }, historyLength: 1 } });
  const next = { ...base, draftHistory: [...base.draftHistory, pick(2, 'second')] };
  const merged = applyDraftSessionChange(base, computeDraftSessionChange(base, next, 'new-pick'));
  expect(merged.draftHistory.map(pick => pick.playerId)).toEqual(['first', 'second']);
  expect(merged.currentPick).toBe(96);
  expect(merged.draftProgress).toEqual({ anchor: { kind: 'carry', pickNumber: 96 }, historyLength: 2 });
});

it('keeps the later cursor when both saves moved it', () => {
  const base = session({ currentPick: 2 });
  const overwritten = session({ currentPick: 4 });
  const newer = session({ currentPick: 3 });
  const merged = applyDraftSessionChange(newer, computeDraftSessionChange(base, overwritten, 'lost'));
  expect(merged.currentPick).toBe(4);
  expect(merged.draftProgress).toEqual({ anchor: { kind: 'carry', pickNumber: 4 }, historyLength: 0 });
});
