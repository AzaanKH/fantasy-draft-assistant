/**
 * Background service-worker entry point.
 *
 * Chrome I/O is wired here; state policy and orchestration live in testable
 * modules that do not execute merely by being imported.
 */

import { createBackgroundController } from './background-controller';
import { ChromeDraftStorage } from './draft-storage';
import { createSyncSnapshotClient } from './sync-snapshot-client';
import { isAuthorizedExtensionMessage } from './message-security';

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

const storage = new ChromeDraftStorage(chrome.storage.local);
const controller = createBackgroundController({
  storage,
  syncClient: createSyncSnapshotClient(() => storage.getSyncServerUrl(), async () => {
    await storageReady;
    return storage.getSyncToken();
  }),
  queryActiveTab: async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  },
  openSidePanel: (tabId) => chrome.sidePanel.open({ tabId }),
  notifyRuntime: (message) => chrome.runtime.sendMessage(message),
});

chrome.action.onClicked.addListener((tab) => {
  void controller.handleActionClick(tab.id);
});

chrome.runtime.onInstalled.addListener((details) => {
  void chrome.sidePanel
    .setOptions({ enabled: true })
    .then(() => controller.handleInstalled(details.reason))
    .catch((error: unknown) => {
      console.warn('[Fantasy Draft BG] Failed to initialize extension:', error);
    });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isAuthorizedExtensionMessage(message, sender, chrome.runtime.id)) {
    sendResponse({ success: false, error: 'Invalid message sender or payload' });
    return false;
  }
  return controller.handleMessage(message, sendResponse);
});

void controller.initialize().catch((error: unknown) => {
  console.warn('[Fantasy Draft BG] Failed to load persisted state:', error);
});
