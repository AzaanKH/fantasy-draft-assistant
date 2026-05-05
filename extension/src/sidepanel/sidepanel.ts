/**
 * Side Panel Script
 *
 * Manages the side panel UI:
 * - Displays detected picks
 * - Allows setting draft position
 * - Opens the full web app
 */

import { STORAGE_KEYS, DEFAULT_SYNC_SERVER_URL, DEFAULT_WEB_APP_URL } from '../shared/types';
import type { DetectedPick, DraftRoomStatus, ExtensionMessage } from '../shared/types';
import type { DraftPickEvent, DraftSyncSnapshot, DraftSyncUpdate } from '@fantasy-draft/shared';

// DOM Elements
const statusBadge = document.getElementById('status-badge') as HTMLSpanElement;
const pickPositionSelect = document.getElementById('pick-position') as HTMLSelectElement;
const openWebappBtn = document.getElementById('open-webapp') as HTMLButtonElement;
const picksList = document.getElementById('picks-list') as HTMLDivElement;
const picksCount = document.getElementById('picks-count') as HTMLSpanElement;
const clearPicksBtn = document.getElementById('clear-picks') as HTMLButtonElement;

// State
let picks: DetectedPick[] = [];
let draftStatus: DraftRoomStatus = { isInDraftRoom: false };
let syncSnapshot: DraftSyncSnapshot | null = null;
let eventSource: EventSource | null = null;

/**
 * Update the status badge
 */
function updateStatusBadge(): void {
  if (syncSnapshot?.draft) {
    const label =
      syncSnapshot.draft.status === 'drafting'
        ? 'Live Sync'
        : syncSnapshot.draft.status === 'complete'
          ? 'Draft Complete'
          : 'Connected';
    statusBadge.textContent = label;
    statusBadge.className = 'status-badge connected';
    return;
  }

  if (draftStatus.isInDraftRoom) {
    statusBadge.textContent = 'In Draft Room';
    statusBadge.className = 'status-badge connected';
  } else {
    statusBadge.textContent = 'Not in draft';
    statusBadge.className = 'status-badge disconnected';
  }
}

/**
 * Render the picks list
 */
function renderPicks(): void {
  const canonicalPicks = syncSnapshot?.picks ?? [];
  picksCount.textContent = canonicalPicks.length.toString();

  if (canonicalPicks.length === 0) {
    picksList.innerHTML = '<div class="empty-state">No synced picks yet</div>';
    clearPicksBtn.style.display = 'none';
    return;
  }

  clearPicksBtn.style.display = syncSnapshot ? 'none' : 'block';

  const html = canonicalPicks
    .map(
      (pick: DraftPickEvent) => `
      <div class="pick-item">
        <span class="pick-number">${pick.pickNumber}.</span>
        <span class="pick-player">${escapeHtml(pick.playerName)}</span>
        <span class="pick-position">${escapeHtml(pick.position)}</span>
        <span class="pick-team">${escapeHtml(pick.nflTeam ?? '')}</span>
      </div>
    `
    )
    .join('');

  picksList.innerHTML = html;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Load state from storage and background
 */
async function loadState(): Promise<void> {
  // Get pick position from storage
  const result = await chrome.storage.local.get([STORAGE_KEYS.MY_PICK_POSITION]);
  const position = result[STORAGE_KEYS.MY_PICK_POSITION] ?? 1;
  pickPositionSelect.value = position.toString();

  // Get picks and status from background
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_DRAFT_STATUS' });
    if (response?.success && response.data) {
      picks = response.data.picks ?? [];
      draftStatus = response.data.status ?? { isInDraftRoom: false };
      syncSnapshot = response.data.snapshot ?? null;
    }
  } catch {
    console.warn('[Side Panel] Failed to get draft status');
  }

  await connectToSyncStream();
  updateStatusBadge();
  renderPicks();
}

async function getSyncServerUrl(): Promise<string> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.SYNC_SERVER_URL]);
  return result[STORAGE_KEYS.SYNC_SERVER_URL] ?? DEFAULT_SYNC_SERVER_URL;
}

async function connectToSyncStream(): Promise<void> {
  if (!draftStatus.draftId) {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    return;
  }

  const syncServerUrl = await getSyncServerUrl();

  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(
    `${syncServerUrl}/api/sync/drafts/${draftStatus.draftId}/events`
  );

  eventSource.onmessage = (event) => {
    const update = JSON.parse(event.data) as DraftSyncUpdate;
    syncSnapshot = update.snapshot;
    updateStatusBadge();
    renderPicks();
  };

  eventSource.onerror = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

/**
 * Handle pick position change
 */
async function handlePickPositionChange(): Promise<void> {
  const position = parseInt(pickPositionSelect.value, 10);
  await chrome.storage.local.set({ [STORAGE_KEYS.MY_PICK_POSITION]: position });
}

/**
 * Open the web app in a new tab
 */
async function openWebApp(): Promise<void> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.WEB_APP_URL]);
  const url = result[STORAGE_KEYS.WEB_APP_URL] ?? DEFAULT_WEB_APP_URL;

  // Pass picks count as URL param so web app knows sync is active
  const picksCountValue = syncSnapshot?.picks.length ?? picks.length;
  const draftIdParam = draftStatus.draftId ? `&draftId=${draftStatus.draftId}` : '';
  const urlWithParams = `${url}?picks=${picksCountValue}&position=${pickPositionSelect.value}${draftIdParam}`;

  await chrome.tabs.create({ url: urlWithParams });
}

/**
 * Clear all detected picks
 */
async function clearPicks(): Promise<void> {
  if (syncSnapshot) {
    return;
  }

  picks = [];
  await chrome.storage.local.set({ [STORAGE_KEYS.DETECTED_PICKS]: [] });
  renderPicks();
}

/**
 * Handle messages from background script
 */
function handleMessage(message: ExtensionMessage): void {
  if (message.type === 'SYNC_STATE' && message.data) {
    picks = message.data.picks ?? picks;
    draftStatus = message.data.status ?? draftStatus;
    syncSnapshot = message.data.snapshot ?? syncSnapshot;
    void connectToSyncStream();
    updateStatusBadge();
    renderPicks();
  }
}

// Event listeners
pickPositionSelect.addEventListener('change', handlePickPositionChange);
openWebappBtn.addEventListener('click', openWebApp);
clearPicksBtn.addEventListener('click', clearPicks);
chrome.runtime.onMessage.addListener(handleMessage);

// Initialize
loadState();
