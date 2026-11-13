import { describe, expect, it } from 'vitest';
import { describeStorageSharingFailure, StorageSharingFailure } from './storage-sharing';

const origin = 'http://localhost:5173';

describe('describeStorageSharingFailure', () => {
  it('passes on the web app refusal with the step that fixes it', () => {
    const copy = describeStorageSharingFailure(new StorageSharingFailure('refused', 'Workspace storage is unavailable.'), origin);
    expect(copy.title).toBe('Draft storage is not shared yet');
    expect(copy.detail).toBe('Workspace storage is unavailable. Open the full draft room in a normal tab so it can share storage with the panel, then retry.');
  });

  it('names the origin that did not answer on timeout', () => {
    expect(describeStorageSharingFailure(new StorageSharingFailure('timeout', 'timed out'), origin).detail).toContain(`Nothing replied from ${origin}`);
  });

  it('falls back to the generic copy for unclassified errors', () => {
    expect(describeStorageSharingFailure(new Error('boom'), origin)).toEqual({
      kind: 'helper', title: 'Web app unavailable',
      detail: 'boom Make sure the Fantasy Draft web app is running on this computer, then retry.',
      hint: 'Running from source? Start it with pnpm dev:live.',
    });
  });

  it('keeps developer commands out of the main copy and offers the canonical switch for origin errors', () => {
    for (const kind of ['permission', 'origin', 'refused', 'timeout', 'helper'] as const) {
      expect(describeStorageSharingFailure(new StorageSharingFailure(kind, 'Reason.'), origin).detail).not.toContain('pnpm');
    }
    expect(describeStorageSharingFailure(new StorageSharingFailure('origin', 'Points elsewhere.'), origin).detail).toContain(`Switch to ${origin} below`);
  });
});
