import { LOCAL_PORTS } from './local-config';
/**
 * Extension message types for communication between
 * content script, background service worker, and side panel
 */

export type { DetectedPick, ExtensionState, ExtensionMessage } from './boundary-decoders';
export type { DraftRoomStatus } from '@fantasy-draft/shared/sync';

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
  SYNC_TOKEN: 'syncToken',
} as const;

/**
 * Default web app URL
 */
export const DEFAULT_WEB_APP_URL = LOCAL_PORTS.webOrigin;
export const DEFAULT_SYNC_SERVER_URL = `http://localhost:${String(LOCAL_PORTS.apiPort)}`;
