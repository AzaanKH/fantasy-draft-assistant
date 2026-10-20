import { describe, expect, it, vi } from 'vitest';
import { readDraftSessionChanges } from './draftSessionUnconfirmedSaves';

describe('stored change boundary', () => {
  it('warns when a corrupt pick move rejects one atomic save and preserves other saves', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prefix = 'fantasy-draft-session-unconfirmed-v1:sleeper:123:';
    const pick = { pickNumber: 1, playerId: 'player', playerName: 'Player', position: 'QB',
      teamIndex: 0, teamName: 'Team', timestamp: 1, source: 'manual' };
    const valid = { version: 1, writeId: 'valid', baseWriteId: null, revision: 1,
      picks: [], queueAdded: ['queued-player'], queueRemoved: [], fields: {} };
    const corruptMove = { ...valid, writeId: 'corrupt', picks: [
      { pickNumber: 1, before: pick, after: null },
      { pickNumber: 2, before: null, after: { playerId: 'player' } },
    ] };
    const rows = new Map([[`${prefix}valid`, JSON.stringify(valid)], [`${prefix}corrupt`, JSON.stringify(corruptMove)]]);
    const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem() {}, removeItem() {},
      key: (index: number) => [...rows.keys()][index] ?? null, length: rows.size };
    try {
      const changes = readDraftSessionChanges(storage, { provider: 'sleeper', draftId: '123' });
      expect(changes.map(({ change }) => change.writeId)).toEqual(['valid']);
      expect(changes[0]?.change.queueAdded).toEqual(['queued-player']);
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        '[Fantasy Draft] Rejected unconfirmed save journals; each save stays atomic to preserve dependent pick moves.',
        { rejectedCount: 1 }
      );
    } finally {
      warning.mockRestore();
    }
  });
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
