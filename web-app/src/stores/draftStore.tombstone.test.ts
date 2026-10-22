import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { createDraftStore } from './draftStore';
import { getDraftSessionStorageKey, persistDraftSession } from './draftSessionStorage';
import { readDraftSessionChanges, removeDraftSessionChange, writeDraftSessionChange } from './draftSessionUnconfirmedSaves';

const tombstoneKey = 'fantasy-draft-storage-migrated';
const tombstone = JSON.stringify({ version: 1, migratedAt: 1770000000000, by: 'migration-test' });
const identity = { provider: 'sleeper', draftId: 'tombstone-test' } as const;
const pick = { pickNumber: 1, playerId: 'observed', playerName: 'Observed', position: 'RB', teamIndex: 0, teamName: 'Team 1' } as const;

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  const store = createDraftStore({ storage, session: identity });
  store.getState().setSessionMode('live');
  store.getState().togglePlayerShortlisted('waiting');
  store.getState().togglePlayerShortlisted('second');
  return { values, storage, store };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('v1 migration tombstone', () => {
  it('keeps current writes and acknowledgements when absent', () => {
    const { store, storage } = fixture();
    expect(store.getState().recordProvisionalPick(pick)).toBe(true);
    expect(storage.getItem(getDraftSessionStorageKey(identity))).toContain('observed');
    expect(readDraftSessionChanges(storage, identity).length).toBeGreaterThan(0);
    expect(storage.getItem(tombstoneKey)).toBeNull();
  });

  it.each([tombstone, '', '{broken', JSON.stringify({ version: 2 })])('loads retained facts without any mutation when present at startup: %s', (marker) => {
    const { storage, values, store } = fixture();
    storage.setItem(tombstoneKey, marker);
    const before = [...values];
    const error = vi.spyOn(toast, 'error');
    const reloaded = createDraftStore({ storage, session: identity });
    expect(reloaded.getState().shortlistedPlayerIds).toEqual(store.getState().shortlistedPlayerIds);
    expect(reloaded.getState().recordProvisionalPick(pick)).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Reload to continue'), expect.any(Object));
    expect([...values]).toEqual(before);
  });

  it('reacts to an external storage event and rejects commands without acknowledging or changing facts', () => {
    const { storage, values, store: first } = fixture();
    let notify: ((key: string | null, newValue: string | null) => void) | undefined;
    const second = createDraftStore({ storage, session: identity, externalChanges: (onChange) => { notify = onChange; return () => {}; } });
    const error = vi.spyOn(toast, 'error');
    storage.setItem(tombstoneKey, tombstone);
    const before = [...values];
    notify?.(tombstoneKey, tombstone);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Reload to continue'), expect.any(Object));
    for (const store of [first, second]) {
      const state = store.getState();
      expect(state.recordProvisionalPick(pick)).toBe(false);
      state.togglePlayerShortlisted('refused');
      state.setDecisionLens('best-player');
      state.resetDraft();
      expect(store.getState()).toBe(state);
    }
    expect([...values]).toEqual(before);
  });

  it('fails closed and logs a malformed tombstone', () => {
    const { storage, store, values } = fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.setItem(tombstoneKey, 'null');
    const before = [...values];
    expect(store.getState().recordProvisionalPick(pick)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tombstone'), expect.any(Object));
    expect([...values]).toEqual(before);
  });

  it('rejects an in-flight command when the tombstone appears after its transition starts', () => {
    const { storage, store, values } = fixture();
    const error = vi.spyOn(toast, 'error');
    const before = [...values];
    const state = store.getState();
    vi.spyOn(Math, 'random').mockImplementationOnce(() => {
      storage.setItem(tombstoneKey, tombstone);
      return 0.5;
    });
    expect(state.recordProvisionalPick(pick)).toBe(false);
    expect(store.getState()).toBe(state);
    expect([...values]).toEqual([...before, [tombstoneKey, tombstone]]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Reload to continue'), expect.any(Object));
  });

  it('blocks writes when the tombstone cannot be read', () => {
    const { storage, store, values } = fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const read = storage.getItem;
    vi.spyOn(storage, 'getItem').mockImplementation((key) => {
      if (key === tombstoneKey) throw new Error('Storage unavailable');
      return read(key);
    });
    const before = [...values];
    expect(store.getState().recordProvisionalPick(pick)).toBe(false);
    expect([...values]).toEqual(before);
    expect(warn).toHaveBeenCalled();
  });

  it('checks the persistence boundary even for force saves and direct journal mutations', () => {
    const { storage, store, values } = fixture();
    const [journal] = readDraftSessionChanges(storage, identity);
    if (!journal) throw new Error('Missing journal fixture');
    storage.setItem(tombstoneKey, tombstone);
    const before = [...values];
    const base = { revision: 0, serialized: null, lineage: [], session: null };
    expect(() => persistDraftSession(storage, store.getState(), base, { force: true })).toThrow('Reload to continue');
    expect(() => { writeDraftSessionChange(storage, identity, 'late-tab', journal.change); }).toThrow('Reload to continue');
    expect(() => { removeDraftSessionChange(storage, journal); }).toThrow('Reload to continue');
    expect([...values]).toEqual(before);
  });
});
