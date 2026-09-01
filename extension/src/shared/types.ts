/**
 * Extension message types for communication between
 * content script, background service worker, and side panel
 */

import {
  isDraftProvider,
  isDraftSyncSnapshot,
  isEspnDraftSnapshot,
  type DraftProvider,
  type DraftSyncSnapshot,
  type EspnDraftSnapshot,
} from '@fantasy-draft/shared';

/**
 * Draft pick detected from Sleeper DOM
 */
export interface DetectedPick {
  playerName: string;
  teamName: string;
  position?: string;
  /** Pick number in format "round.pick" e.g. "1.5" for 5th pick of round 1 */
  pickNumber?: string;
  timestamp: number;
}

/**
 * Draft room status
 */
export interface DraftRoomStatus {
  isInDraftRoom: boolean;
  provider?: DraftProvider;
  draftId?: string;
  myDraftSlot?: number;
  status?: 'pre_draft' | 'drafting' | 'paused' | 'complete';
}

export interface ExtensionState {
  readonly picks: DetectedPick[];
  readonly status: DraftRoomStatus;
  readonly snapshot?: DraftSyncSnapshot | null;
}

/**
 * Message types for extension communication
 */
export type ExtensionMessage =
  | { type: 'PICK_DETECTED'; data: DetectedPick }
  | { type: 'ESPN_DRAFT_SNAPSHOT'; data: EspnDraftSnapshot }
  | { type: 'DRAFT_ROOM_STATUS'; data: DraftRoomStatus }
  | { type: 'GET_DRAFT_STATUS' }
  | { type: 'OPEN_SIDE_PANEL' }
  | { type: 'SYNC_STATE'; data: ExtensionState };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isDetectedPick(value: unknown): value is DetectedPick {
  return (
    isRecord(value) &&
    typeof value['playerName'] === 'string' &&
    typeof value['teamName'] === 'string' &&
    (value['position'] === undefined || typeof value['position'] === 'string') &&
    (value['pickNumber'] === undefined || typeof value['pickNumber'] === 'string') &&
    isFiniteNumber(value['timestamp'])
  );
}

export function isDraftRoomStatus(value: unknown): value is DraftRoomStatus {
  return (
    isRecord(value) &&
    typeof value['isInDraftRoom'] === 'boolean' &&
    (value['provider'] === undefined || isDraftProvider(value['provider'])) &&
    (value['draftId'] === undefined || typeof value['draftId'] === 'string') &&
    (
      value['myDraftSlot'] === undefined ||
      (Number.isInteger(value['myDraftSlot']) &&
        isFiniteNumber(value['myDraftSlot']) &&
        value['myDraftSlot'] >= 1)
    ) &&
    (
      value['status'] === undefined ||
      value['status'] === 'pre_draft' ||
      value['status'] === 'drafting' ||
      value['status'] === 'paused' ||
      value['status'] === 'complete'
    )
  );
}

export function isExtensionState(value: unknown): value is ExtensionState {
  return (
    isRecord(value) &&
    Array.isArray(value['picks']) &&
    value['picks'].every(isDetectedPick) &&
    isDraftRoomStatus(value['status']) &&
    (
      value['snapshot'] === undefined ||
      value['snapshot'] === null ||
      isDraftSyncSnapshot(value['snapshot'])
    )
  );
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    return false;
  }

  switch (value['type']) {
    case 'PICK_DETECTED':
      return isDetectedPick(value['data']);
    case 'ESPN_DRAFT_SNAPSHOT':
      return isEspnDraftSnapshot(value['data']);
    case 'DRAFT_ROOM_STATUS':
      return isDraftRoomStatus(value['data']);
    case 'GET_DRAFT_STATUS':
    case 'OPEN_SIDE_PANEL':
      return true;
    case 'SYNC_STATE':
      return isExtensionState(value['data']);
    default:
      return false;
  }
}

/**
 * Response type for messages
 */
export interface MessageResponse {
  success: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Storage keys for chrome.storage.local
 */
export const STORAGE_KEYS = {
  DETECTED_PICKS: 'detectedPicks',
  DRAFT_STATUS: 'draftStatus',
  MY_PICK_POSITION: 'myPickPosition',
  WEB_APP_URL: 'webAppUrl',
  SYNC_SERVER_URL: 'syncServerUrl',
} as const;

/**
 * Default web app URL
 */
export const DEFAULT_WEB_APP_URL = 'http://localhost:3000';
export const DEFAULT_SYNC_SERVER_URL = 'http://localhost:3001';
