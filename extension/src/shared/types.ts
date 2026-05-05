/**
 * Extension message types for communication between
 * content script, background service worker, and side panel
 */

import type { DraftSyncSnapshot, Position } from '@fantasy-draft/shared';

/**
 * Draft pick detected from Sleeper DOM
 */
export interface DetectedPick {
  playerName: string;
  teamName: string;
  position?: Position | string;
  /** Pick number in format "round.pick" e.g. "1.5" for 5th pick of round 1 */
  pickNumber?: string;
  timestamp: number;
}

/**
 * Draft room status
 */
export interface DraftRoomStatus {
  isInDraftRoom: boolean;
  draftId?: string;
  status?: 'pre_draft' | 'drafting' | 'complete';
}

/**
 * Message types for extension communication
 */
export type ExtensionMessage =
  | { type: 'PICK_DETECTED'; data: DetectedPick }
  | { type: 'DRAFT_ROOM_STATUS'; data: DraftRoomStatus }
  | { type: 'GET_DRAFT_STATUS' }
  | { type: 'OPEN_SIDE_PANEL' }
  | { type: 'SYNC_STATE'; data: { picks: DetectedPick[]; status: DraftRoomStatus; snapshot?: DraftSyncSnapshot | null } };

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
