import { describe, expect, it } from 'vitest';
import { DEVELOPER_START_HINT, describeStorageSharingFailure, StorageSharingFailure } from './storage-sharing';

const origin = 'http://localhost:5173';

describe('describeStorageSharingFailure', () => {
  it.each([
    ['refused', new StorageSharingFailure('refused', 'Workspace storage is unavailable.'), 'refused', /Workspace storage is unavailable\..*full draft room/],
    ['timeout', new StorageSharingFailure('timeout', 'timed out'), 'timeout', new RegExp(`Nothing replied from ${origin}`)],
    ['origin', new StorageSharingFailure('origin', 'Points elsewhere.'), 'origin', new RegExp(`Points elsewhere\\..*Switch to ${origin} below`)],
    ['an unclassified error', new Error('boom'), 'helper', /^boom .*web app is running/],
  ] as const)('keeps the reason and names the fix for %s', (_label, error, kind, detail) => {
    const copy = describeStorageSharingFailure(error, origin);
    expect(copy.kind).toBe(kind);
    expect(copy.detail).toMatch(detail);
  });

  it('keeps developer commands out of the main copy and in the hint when the app may not be running', () => {
    for (const kind of ['permission', 'origin', 'refused', 'timeout', 'helper'] as const) {
      const copy = describeStorageSharingFailure(new StorageSharingFailure(kind, 'Reason.'), origin);
      expect(copy.detail).not.toContain('pnpm');
      expect(copy.hint).toBe(kind === 'timeout' || kind === 'helper' ? DEVELOPER_START_HINT : undefined);
    }
  });
});
