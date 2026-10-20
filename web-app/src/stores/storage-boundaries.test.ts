import { describe, expect, it } from 'vitest';
import { readDraftSessionChanges } from './draftSessionUnconfirmedSaves';

describe('stored change boundary', () => {
  it.each([
    { picks: [{ pickNumber: 1, before: { playerId: 'broken' }, after: null }] },
    { fields: { currentPick: { before: 'one', after: 2 } } },
  ])('rejects a malformed journal atomically before merging %j', (invalid) => {
    const key = 'fantasy-draft-session-unconfirmed-v1:sleeper:123:tab';
    const serialized = JSON.stringify({ version: 1, writeId: 'write', baseWriteId: null, revision: 1,
      picks: [], queueAdded: [], queueRemoved: [], fields: {}, ...invalid });
    const storage = { getItem: () => serialized, setItem() {}, removeItem() {}, key: () => key, length: 1 };
    expect(readDraftSessionChanges(storage, { provider: 'sleeper', draftId: '123' })).toEqual([]);
  });
});

describe('preferences and refresh status boundaries', () => {
  it('preserves zero reception scoring and rejects malformed preferences', async () => {
    const { decodeQuickMockPreferences } = await import('@fantasy-draft/shared/catalog');
    const preferences = { totalTeams: 12, totalRounds: 15, reception: 0, passingTouchdown: 4 };
    expect(decodeQuickMockPreferences(preferences)).toEqual(preferences);
    expect(() => decodeQuickMockPreferences({ ...preferences, reception: '0' })).toThrow();
    expect(() => decodeQuickMockPreferences({ ...preferences, totalTeams: 21 })).toThrow();
  });
  it('preserves refresh failure details and rejects malformed nested steps', async () => {
    const { decodeDraftDataRefreshStatus } = await import('@fantasy-draft/shared/catalog');
    const status = { state: 'failed', steps: [{ key: 'sleeper-directory', label: 'Sleeper', state: 'failed' }],
      startedAt: '2026-10-19T12:00:00Z', finishedAt: '2026-10-19T12:00:01Z', error: 'Refresh failed', detail: 'Request timed out' };
    expect(decodeDraftDataRefreshStatus(status)).toEqual(status);
    expect(() => decodeDraftDataRefreshStatus({ ...status, steps: [{ ...status.steps[0], state: 'done' }] })).toThrow();
  });
});
