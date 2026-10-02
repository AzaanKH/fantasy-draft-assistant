import { describe, expect, it } from 'vitest';
import { isDraftSessionSummary, type DraftSessionSummary } from './index.js';

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

  it('validates the nested sync state', () => {
    expect(isDraftSessionSummary({ ...summary, sync: null })).toBe(false);
    expect(isDraftSessionSummary({ ...summary, sync: { ...summary.sync, state: 'offline' } })).toBe(false);
    expect(isDraftSessionSummary({ ...summary, sync: { ...summary.sync, lastError: 500 } })).toBe(false);
    expect(isDraftSessionSummary({ ...summary, sync: { state: 'error', lastSuccessfulSyncAt: 900, lastError: 'Sleeper request failed: 503' } })).toBe(true);
  });
});
