import { describe, expect, it } from 'vitest';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared';
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
    version: 1, revision: 1, lineage: ['base'], identity: { provider: 'sleeper', draftId: '123' },
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
});
