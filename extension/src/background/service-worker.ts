/**
 * Background service-worker entry point.
 *
 * Chrome I/O is wired here; state policy and orchestration live in testable
 * modules that do not execute merely by being imported.
 */

import { createBackgroundController } from './background-controller';
import { ChromeDraftStorage } from './draft-storage';
import { createSyncSnapshotClient } from './sync-snapshot-client';
import { isExtensionMessage } from '../shared/types';

const storage = new ChromeDraftStorage(chrome.storage.local);
const controller = createBackgroundController({
  storage,
  syncClient: createSyncSnapshotClient(() => storage.getSyncServerUrl()),
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

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isExtensionMessage(message)) {
      sendResponse({ success: false, error: 'Invalid extension message' });
      return false;
    }
    return controller.handleMessage(message, sendResponse);
  }
);

void controller.initialize().catch((error: unknown) => {
  console.warn('[Fantasy Draft BG] Failed to load persisted state:', error);
});
