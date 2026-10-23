import { describe, expect, it } from 'vitest';
import { isDraftSessionSummary } from './catalog/sync-decoders.js';
import { isDraftSessionIdentity, isDraftSyncConnection, isValidDraftSyncId, type DraftSessionSummary } from './sessions.js';
import { isQuickMockPreferences, isLeagueSetupPreferences } from './draft/quick-mock-settings.js';
import { decodeDraftSessionIdentity, decodeDraftSyncConnection, decodeQuickMockPreferences, decodeLeagueSetupPreferences } from './catalog/storage-decoders.js';
import { decodeOrNull } from './catalog/decoders.js';

const summary: DraftSessionSummary = {
  session: 'sleeper:draft-1',
  provider: 'sleeper',
  draftId: 'draft-1',
  draftStatus: 'drafting',
  draftType: 'snake',
  totalTeams: 10,
  totalRounds: 14,
  currentPick: 12,
  picksRecorded: 11,
  sync: { state: 'synced', lastSuccessfulSyncAt: 1_000, lastError: null },
  lastActivityAt: 1_000,
  subscribers: 1,
};

describe('draft session summaries', () => {
  it('accepts connected and not-yet-observed sessions', () => {
    expect(isDraftSessionSummary(summary)).toBe(true);
    expect(isDraftSessionSummary({
      ...summary, session: 'espn:4242', provider: 'espn', draftId: '4242',
      draftStatus: null, draftType: null, totalTeams: null, totalRounds: null, currentPick: null,
      picksRecorded: 0, sync: { state: 'idle', lastSuccessfulSyncAt: null, lastError: null },
    })).toBe(true);
  });

  it('accepts a completed draft whose current pick is one past the last pick', () => {
    expect(isDraftSessionSummary({ ...summary, draftStatus: 'complete', currentPick: 32 * 40 + 1 })).toBe(true);
  });

  it('requires the session key to match the provider and draft ID', () => {
    expect(isDraftSessionSummary({ ...summary, session: 'yahoo:draft-1' })).toBe(false);
    expect(isDraftSessionSummary({ ...summary, session: 'sleeper:other' })).toBe(false);
  });

  it.each([
    ['an unknown provider', { provider: 'nfl', session: 'nfl:draft-1' }],
    ['an oversized draft ID', { draftId: 'x'.repeat(129), session: `sleeper:${'x'.repeat(129)}` }],
    ['an unknown draft status', { draftStatus: 'cancelled' }],
    ['an unknown draft type', { draftType: 'keeper' }],
    ['too many teams', { totalTeams: 33 }],
    ['zero rounds', { totalRounds: 0 }],
    ['a pick past the largest draft', { currentPick: 32 * 40 + 2 }],
    ['a negative pick count', { picksRecorded: -1 }],
    ['too many subscribers', { subscribers: 33 }],
    ['a non-finite activity time', { lastActivityAt: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_label, overrides) => {
    expect(isDraftSessionSummary({ ...summary, ...overrides })).toBe(false);
  });

  it('rejects sync-state values that only stringify to a valid state', () => {
    expect(isDraftSessionSummary({ ...summary, sync: { ...summary.sync, state: ['synced'] } })).toBe(false);
    expect(isDraftSessionSummary({ ...summary, sync: { ...summary.sync, state: { toString: () => 'synced' } } })).toBe(false);
  });

  it('validates the nested sync state', () => {
    expect(isDraftSessionSummary({ ...summary, sync: null })).toBe(false);
    expect(isDraftSessionSummary({ ...summary, sync: { ...summary.sync, state: 'offline' } })).toBe(false);
    expect(isDraftSessionSummary({ ...summary, sync: { ...summary.sync, lastError: 500 } })).toBe(false);
    expect(isDraftSessionSummary({ ...summary, sync: { state: 'error', lastSuccessfulSyncAt: 900, lastError: 'Sleeper request failed: 503' } })).toBe(true);
  });
});

describe('plain draft helpers', () => {
  it('matches the boundary decoders for identity, connection and quick-mock inputs', () => {
    for (const provider of ['sleeper', 'espn', 'yahoo'] as const) {
      for (const draftId of [null, 42, '', 'Draft_1-abc', '42', '1'.repeat(20), '1'.repeat(21), 'x'.repeat(128), 'x'.repeat(129), ' 42']) {
        const identity = { provider, draftId };
        expect(isDraftSessionIdentity(identity)).toBe(decodeOrNull(decodeDraftSessionIdentity, identity) !== null);
        expect(isValidDraftSyncId(provider, draftId)).toBe(isDraftSessionIdentity(identity));
        for (const draftPosition of [null, 0, 1, 20, 21]) {
          const connection = { ...identity, draftPosition };
          expect(isDraftSyncConnection(connection)).toBe(decodeOrNull(decodeDraftSyncConnection, connection) !== null);
        }
      }
    }
    const connection = { provider: 'sleeper', draftId: '42', draftPosition: null };
    for (const extras of [{ settingsProfile: 'quick-mock' }, { settingsProfile: 'unknown' }, { usePrimaryLeagueSettings: true }, { usePrimaryLeagueSettings: 'true' }, { settingsProfile: 'quick-mock', usePrimaryLeagueSettings: true }]) {
      const value = { ...connection, ...extras };
      expect(isDraftSyncConnection(value)).toBe(decodeOrNull(decodeDraftSyncConnection, value) !== null);
    }
    const preferences = { totalTeams: 12, totalRounds: 15, reception: 1, passingTouchdown: 4 };
    for (const value of [null, [], preferences, { ...preferences, totalTeams: 1 }, { ...preferences, totalTeams: 20 }, { ...preferences, totalRounds: 9 }, { ...preferences, reception: 0.5 }, { ...preferences, reception: '1' }, { ...preferences, passingTouchdown: 6 }, { ...preferences, passingTouchdown: 5 }]) {
      expect(isQuickMockPreferences(value)).toBe(decodeOrNull(decodeQuickMockPreferences, value) !== null);
      for (const profile of ['quick-mock', 'primary-league', 'invalid', null]) {
        const setup = { profile, quickMock: value };
        expect(isLeagueSetupPreferences(setup)).toBe(decodeOrNull(decodeLeagueSetupPreferences, setup) !== null);
      }
    }
  });
});
