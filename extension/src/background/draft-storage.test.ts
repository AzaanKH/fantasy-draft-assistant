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

describe('pairing token storage', () => {
  it('requires a saved valid token and preserves pairing through install defaults', async () => {
    const contents: Record<string, unknown> = {};
    const area = {
      get: vi.fn(async () => contents),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(contents, values); }),
    } as unknown as ConstructorParameters<typeof ChromeDraftStorage>[0];
    const storage = new ChromeDraftStorage(area);
    await expect(storage.getSyncToken()).rejects.toThrow('Pair the extension');
    contents['syncToken'] = 'x'.repeat(43);
    await storage.setInstallationDefaults();
    await expect(storage.getSyncToken()).resolves.toBe('x'.repeat(43));
  });
});
