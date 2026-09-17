import { describe, expect, it } from 'vitest';
import { getRestoredProviderTruthSnapshotAt } from './LiveDraftSyncProvider';

describe('restored Provider Truth detection', () => {
  it('starts Reconciliation only for a newer complete Sleeper snapshot', () => {
    const baseline = {
      provider: 'sleeper' as const,
      isManualContinuity: true,
      connectionState: 'connected' as const,
      syncStatus: 'synced' as const,
      lastSuccessfulSyncAt: 200,
      manualContinuityBaselineAt: 100,
    };

    expect(getRestoredProviderTruthSnapshotAt(baseline)).toBe(200);
    expect(getRestoredProviderTruthSnapshotAt({
      ...baseline,
      lastSuccessfulSyncAt: 100,
    })).toBeNull();
    expect(getRestoredProviderTruthSnapshotAt({
      ...baseline,
      connectionState: 'reconnecting',
    })).toBeNull();
    expect(getRestoredProviderTruthSnapshotAt({
      ...baseline,
      syncStatus: 'error',
    })).toBeNull();
    expect(getRestoredProviderTruthSnapshotAt({
      ...baseline,
      provider: 'yahoo',
    })).toBeNull();
  });

  it('accepts a final successful snapshot when Sleeper completed during the outage', () => {
    expect(getRestoredProviderTruthSnapshotAt({
      provider: 'sleeper',
      isManualContinuity: true,
      connectionState: 'complete',
      syncStatus: 'synced',
      lastSuccessfulSyncAt: 300,
      manualContinuityBaselineAt: 100,
    })).toBe(300);
  });
});
