import { describe, expect, it } from 'vitest';
import { getHeaderSyncState } from './DraftSessionStatus';

describe('the header sync state', () => {
  it('says a mock or preview is local, in plain words', () => {
    expect(getHeaderSyncState('mock', null)).toEqual({ label: 'Local', tone: 'local' });
    expect(getHeaderSyncState('mock', 'disconnected').label).toBe('Local');
    expect(getHeaderSyncState('setup', null).label).toBe('Not connected');
  });

  it.each([
    ['confirmed', /^Synced$/, 'ok'],
    ['complete', /complete/i, 'ok'],
    ['reconciling', /^Syncing$/, 'pending'],
    ['delayed', /delayed/i, 'warn'],
    ['manual-continuity', /lost.*locally/i, 'lost'],
    ['disconnected', /^Disconnected$/, 'lost'],
    [null, /^Connecting$/, 'pending'],
  ] as const)('shows the live %s state as its own meaning', (state, label, tone) => {
    const shown = getHeaderSyncState('live', state);
    expect(shown.label).toMatch(label);
    expect(shown.tone).toBe(tone);
  });
});
