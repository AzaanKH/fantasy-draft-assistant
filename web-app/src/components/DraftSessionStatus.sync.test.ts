import { describe, expect, it } from 'vitest';
import { getHeaderSyncState } from './DraftSessionStatus';

describe('the header sync state', () => {
  it('says a mock or preview is local, in plain words', () => {
    expect(getHeaderSyncState('mock', null)).toEqual({ label: 'Local', tone: 'local' });
    expect(getHeaderSyncState('mock', 'disconnected').label).toBe('Local');
    expect(getHeaderSyncState('setup', null).label).toBe('Not connected');
  });

  it('names every live state without provider jargon', () => {
    const labels = (['confirmed', 'complete', 'reconciling', 'delayed', 'manual-continuity', 'disconnected'] as const)
      .map((state) => getHeaderSyncState('live', state).label);
    expect(labels).toEqual(['Synced', 'Draft complete', 'Syncing', 'Sync delayed', 'Sync lost · recording locally', 'Disconnected']);
    expect(labels.join(' ')).not.toMatch(/Provider Truth|Reconcil/);
    expect(getHeaderSyncState('live', null).label).toBe('Connecting');
  });
});
