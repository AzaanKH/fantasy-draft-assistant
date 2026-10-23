import { decodeDetectedPicks, decodeDraftRoomStatus, decodeStoredString, decodeSyncToken } from '../shared/boundary-decoders';
import {
  DEFAULT_SYNC_SERVER_URL,
  STORAGE_KEYS,
  type DetectedPick,
  type DraftRoomStatus,
} from '../shared/types';
import { EMPTY_DRAFT_STATE, type PersistedDraftState } from './draft-state';

function readStored<A>(decode: (value: unknown) => A, value: unknown, fallback: A, key: string): A {
  if (value === undefined) return fallback;
  try { return decode(value); } catch (error) {
    console.warn(`[Fantasy Draft BG] Rejected stored ${key}:`, error);
    return fallback;
  }
}

type LocalStorageArea = Pick<typeof chrome.storage.local, 'get' | 'set'>;

export interface DraftStorage {
  load(): Promise<PersistedDraftState>;
  savePicks(picks: readonly DetectedPick[]): Promise<void>;
  saveStatus(status: DraftRoomStatus): Promise<void>;
  getSyncServerUrl(): Promise<string>;
  getSyncToken(): Promise<string>;
  setInstallationDefaults(): Promise<void>;
}

export class ChromeDraftStorage implements DraftStorage {
  public constructor(private readonly storage: LocalStorageArea) {}

  public async load(): Promise<PersistedDraftState> {
    const result = await this.storage.get([
      STORAGE_KEYS.DETECTED_PICKS,
      STORAGE_KEYS.DRAFT_STATUS,
    ]);
    const storedPicks: unknown = result[STORAGE_KEYS.DETECTED_PICKS];
    const storedStatus: unknown = result[STORAGE_KEYS.DRAFT_STATUS];

    return {
      picks: [...readStored(decodeDetectedPicks, storedPicks, EMPTY_DRAFT_STATE.picks, STORAGE_KEYS.DETECTED_PICKS)],
      status: readStored(decodeDraftRoomStatus, storedStatus, EMPTY_DRAFT_STATE.status, STORAGE_KEYS.DRAFT_STATUS),
    };
  }

  public async savePicks(picks: readonly DetectedPick[]): Promise<void> {
    await this.storage.set({
      [STORAGE_KEYS.DETECTED_PICKS]: picks,
    });
  }

  public async saveStatus(status: DraftRoomStatus): Promise<void> {
    await this.storage.set({
      [STORAGE_KEYS.DRAFT_STATUS]: status,
    });
  }

  public async getSyncServerUrl(): Promise<string> {
    const result = await this.storage.get([STORAGE_KEYS.SYNC_SERVER_URL]);
    return readStored(decodeStoredString, result[STORAGE_KEYS.SYNC_SERVER_URL], DEFAULT_SYNC_SERVER_URL, STORAGE_KEYS.SYNC_SERVER_URL);
  }

  public async getSyncToken(): Promise<string> {
    const result = await this.storage.get([STORAGE_KEYS.SYNC_TOKEN]);
    try { return decodeSyncToken(result[STORAGE_KEYS.SYNC_TOKEN]); } catch (cause) {
      throw new Error('Pair the extension in its options before connecting a draft', { cause });
    }
  }

  public async setInstallationDefaults(): Promise<void> {
    await this.storage.set({
      [STORAGE_KEYS.MY_PICK_POSITION]: 1,
      [STORAGE_KEYS.SYNC_SERVER_URL]: DEFAULT_SYNC_SERVER_URL,
    });
  }
}
