import {
  DEFAULT_SYNC_SERVER_URL,
  STORAGE_KEYS,
  isDetectedPick,
  isDraftRoomStatus,
  type DetectedPick,
  type DraftRoomStatus,
} from '../shared/types';
import { EMPTY_DRAFT_STATE, type PersistedDraftState } from './draft-state';

type LocalStorageArea = Pick<typeof chrome.storage.local, 'get' | 'set'>;

export interface DraftStorage {
  load(): Promise<PersistedDraftState>;
  savePicks(picks: readonly DetectedPick[]): Promise<void>;
  saveStatus(status: DraftRoomStatus): Promise<void>;
  getSyncServerUrl(): Promise<string>;
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
      picks: Array.isArray(storedPicks) && storedPicks.every(isDetectedPick)
        ? storedPicks
        : EMPTY_DRAFT_STATE.picks,
      status: isDraftRoomStatus(storedStatus)
        ? storedStatus
        : EMPTY_DRAFT_STATE.status,
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
    return (
      (result[STORAGE_KEYS.SYNC_SERVER_URL] as string | undefined) ??
      DEFAULT_SYNC_SERVER_URL
    );
  }

  public async setInstallationDefaults(): Promise<void> {
    await this.storage.set({
      [STORAGE_KEYS.MY_PICK_POSITION]: 1,
      [STORAGE_KEYS.SYNC_SERVER_URL]: DEFAULT_SYNC_SERVER_URL,
    });
  }
}
