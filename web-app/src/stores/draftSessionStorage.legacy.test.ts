import { describe, expect, it } from 'vitest';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import { parseStoredDraftSession } from './draftSessionStorage';
import { defaultConfig } from './draft/state';

const identity = { provider: 'sleeper', draftId: '123' } as const;
const { draftType: _draftType, ...configBeforeDraftType } = defaultConfig;
const first = { pickNumber: 1, playerId: 'first', playerName: 'First', position: 'WR',
  teamIndex: 0, teamName: 'Team 1', source: 'sync', timestamp: 100 } as const;
// Snake order gives pick 11 to the tenth team; linear order would give it to the first.
const provisional = { pickNumber: 11, playerId: 'eleventh', playerName: 'Eleventh', position: 'RB',
  teamIndex: 9, teamName: 'Team 10', source: 'provisional', timestamp: 200 } as const;

/** A session saved before draft types, multi-tab merging, and draft progress. */
const original = {
  version: 1, identity, config: configBeforeDraftType, leagueSettings: createDefaultLeagueSettings(),
  currentPick: 12, draftHistory: [provisional, first],
  shortlistedPlayerIds: ['waiting'], preloadedKeepers: [], keepersInitialized: false,
  unresolvedProviderPicks: [], decisionLens: 'best-pick', manualContinuityBaselineAt: 50,
  lastConfirmedSyncAt: 100, lastConfirmedPickNumber: 1,
};

const migrated = {
  ...original,
  config: defaultConfig,
  revision: 0,
  lineage: [],
  draftHistory: [first, provisional],
  draftProgress: { anchor: { kind: 'carry', pickNumber: 12 }, historyLength: 2 },
};

describe('sessions saved by older versions', () => {
  it('loads the original shape as a snake draft at revision 0 with carried progress', () => {
    expect(parseStoredDraftSession(JSON.stringify(original), identity)).toEqual(migrated);
  });

  it.each([
    ['draft type', { ...original, revision: 4, lineage: ['a', 'b'],
      draftProgress: { anchor: { kind: 'branch', pickNumber: 12 }, historyLength: 2 } },
    { ...migrated, revision: 4, lineage: ['a', 'b'], draftProgress: { anchor: { kind: 'branch', pickNumber: 12 }, historyLength: 2 } }],
    ['revision and lineage', { ...original, config: defaultConfig,
      draftProgress: { anchor: { kind: 'branch', pickNumber: 12 }, historyLength: 2 } },
    { ...migrated, draftProgress: { anchor: { kind: 'branch', pickNumber: 12 }, historyLength: 2 } }],
    ['draft progress', { ...original, config: defaultConfig, revision: 4, lineage: ['a'] },
      { ...migrated, revision: 4, lineage: ['a'] }],
  ])('fills in a missing %s and keeps the saved fields', (_field, stored, expected) => {
    expect(parseStoredDraftSession(JSON.stringify(stored), identity)).toEqual(expected);
  });

  it('keeps an explicit linear draft type, which rejects the snake-order provisional pick', () => {
    expect(parseStoredDraftSession(JSON.stringify({ ...original, config: { ...defaultConfig, draftType: 'linear' } }), identity)).toBeNull();
  });
});
