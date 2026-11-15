import { describe, expect, it } from 'vitest';
import { getHeaderSyncState } from './DraftSessionStatus';

describe('the header sync state', () => {
  it('says a mock or preview is local, in plain words', () => {
    expect(getHeaderSyncState('mock', null)).toEqual({ label: 'Local', tone: 'local' });
    expect(getHeaderSyncState('mock', 'disconnected').label).toBe('Local');
    expect(getHeaderSyncState('setup', null).label).toBe('Not connected');
  });

  it('gives every live state its own label, and Connecting before the first state', () => {
    const states = ['confirmed', 'complete', 'reconciling', 'delayed', 'manual-continuity', 'disconnected'] as const;
    const labels = states.map((state) => getHeaderSyncState('live', state).label);
    expect(new Set(labels).size).toBe(states.length);
    expect(getHeaderSyncState('live', 'confirmed').label).toBe('Synced');
    expect(getHeaderSyncState('live', null).label).toBe('Connecting');
  });
});
