import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../shared/types';
import { ChromeDraftStorage } from './draft-storage';
import { EMPTY_DRAFT_STATE } from './draft-state';

describe('ChromeDraftStorage', () => {
  it('falls back when persisted draft state is invalid', async () => {
    const storage = {
      get: vi.fn(async () => ({
        [STORAGE_KEYS.DETECTED_PICKS]: [{ playerName: 'Missing fields' }],
        [STORAGE_KEYS.DRAFT_STATUS]: {
          isInDraftRoom: true,
          provider: 'invalid',
        },
      })),
      set: vi.fn(async () => undefined),
    } as unknown as ConstructorParameters<typeof ChromeDraftStorage>[0];

    await expect(new ChromeDraftStorage(storage).load()).resolves.toEqual(
      EMPTY_DRAFT_STATE
    );
  });
});
