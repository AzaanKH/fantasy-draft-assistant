/**
 * Background Service Worker
 *
 * Handles:
 * - Messages from content scripts
 * - Side panel management
 * - State persistence
 * - Communication with web app (if needed)
 */

import type {
  ExtensionMessage,
  MessageResponse,
  DetectedPick,
  DraftRoomStatus,
} from '../shared/types';
import { STORAGE_KEYS } from '../shared/types';

// In-memory state
let detectedPicks: DetectedPick[] = [];
let draftStatus: DraftRoomStatus = { isInDraftRoom: false };

/**
 * Save picks to storage
 */
async function savePicks(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.DETECTED_PICKS]: detectedPicks,
  });
}

/**
 * Save draft status to storage
 */
async function saveDraftStatus(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.DRAFT_STATUS]: draftStatus,
  });
}

/**
 * Load state from storage
 */
async function loadState(): Promise<void> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.DETECTED_PICKS,
    STORAGE_KEYS.DRAFT_STATUS,
  ]);

  detectedPicks = result[STORAGE_KEYS.DETECTED_PICKS] ?? [];
  draftStatus = result[STORAGE_KEYS.DRAFT_STATUS] ?? { isInDraftRoom: false };
}

/**
 * Handle incoming messages from content script or side panel
 */
function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): boolean {
  console.log('[Fantasy Draft BG] Received message:', message.type);

  switch (message.type) {
    case 'PICK_DETECTED': {
      const pick = message.data;

      // Avoid duplicates (same player within 5 seconds)
      const isDuplicate = detectedPicks.some(
        (p) =>
          p.playerName === pick.playerName &&
          Math.abs(p.timestamp - pick.timestamp) < 5000
      );

      if (!isDuplicate) {
        detectedPicks.push(pick);
        savePicks();
        console.log('[Fantasy Draft BG] Pick saved:', pick.playerName);

        // Notify side panel of new pick
        notifySidePanel();
      }

      sendResponse({ success: true });
      break;
    }

    case 'DRAFT_ROOM_STATUS': {
      draftStatus = message.data;
      saveDraftStatus();
      console.log('[Fantasy Draft BG] Draft status updated:', draftStatus);

      // If entering draft room, open side panel
      if (draftStatus.isInDraftRoom) {
        openSidePanelForCurrentTab();
      }

      sendResponse({ success: true });
      break;
    }

    case 'GET_DRAFT_STATUS': {
      sendResponse({
        success: true,
        data: { picks: detectedPicks, status: draftStatus },
      });
      break;
    }

    case 'OPEN_SIDE_PANEL': {
      openSidePanelForCurrentTab();
      sendResponse({ success: true });
      break;
    }

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // Keep channel open for async response
}

/**
 * Open side panel for the current active tab
 */
async function openSidePanelForCurrentTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (error) {
    console.warn('[Fantasy Draft BG] Failed to open side panel:', error);
  }
}

/**
 * Notify side panel of state changes
 */
function notifySidePanel(): void {
  chrome.runtime
    .sendMessage({
      type: 'SYNC_STATE',
      data: { picks: detectedPicks, status: draftStatus },
    })
    .catch(() => {
      // Side panel might not be open, ignore error
    });
}

/**
 * Handle extension icon click - open side panel
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
      console.error('[Fantasy Draft BG] Failed to open side panel:', error);
    }
  }
});

/**
 * Handle extension installation/update
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Fantasy Draft BG] Extension installed/updated:', details.reason);

  // Set default side panel behavior
  await chrome.sidePanel.setOptions({
    enabled: true,
  });

  // Initialize storage with defaults
  await chrome.storage.local.set({
    [STORAGE_KEYS.MY_PICK_POSITION]: 1,
  });
});

// Set up message listener
chrome.runtime.onMessage.addListener(handleMessage);

// Load state on startup
loadState();

console.log('[Fantasy Draft BG] Service worker initialized');
