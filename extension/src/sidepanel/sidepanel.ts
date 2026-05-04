/**
 * Side Panel Script
 *
 * Manages the side panel UI:
 * - Displays detected picks
 * - Allows setting draft position
 * - Opens the full web app
 */

import { STORAGE_KEYS, DEFAULT_WEB_APP_URL } from '../shared/types';
import type { DetectedPick, DraftRoomStatus, ExtensionMessage } from '../shared/types';

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

/**
 * Update the status badge
 */
function updateStatusBadge(): void {
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
  picksCount.textContent = picks.length.toString();

  if (picks.length === 0) {
    picksList.innerHTML = '<div class="empty-state">No picks detected yet</div>';
    clearPicksBtn.style.display = 'none';
    return;
  }

  clearPicksBtn.style.display = 'block';

  const html = picks
    .map(
      (pick, index) => `
      <div class="pick-item">
        <span class="pick-number">${pick.pickNumber ?? (index + 1)}.</span>
        <span class="pick-player">${escapeHtml(pick.playerName)}</span>
        ${pick.position ? `<span class="pick-position">${escapeHtml(pick.position)}</span>` : ''}
        <span class="pick-team">${escapeHtml(pick.teamName)}</span>
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
    }
  } catch {
    console.warn('[Side Panel] Failed to get draft status');
  }

  updateStatusBadge();
  renderPicks();
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
  const urlWithParams = `${url}?picks=${picks.length}&position=${pickPositionSelect.value}`;

  await chrome.tabs.create({ url: urlWithParams });
}

/**
 * Clear all detected picks
 */
async function clearPicks(): Promise<void> {
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
