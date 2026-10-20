/**
 * Side panel bootstrap.
 *
 * The extension owns provider detection and draft-room context. The rendered
 * side panel comes from the web app so rankings, roster state, comparison
 * logic, and theme preferences stay identical across both surfaces.
 */

import { decodeOrNull } from '@fantasy-draft/shared/catalog';
import { decodeExtensionMessage, decodeExtensionStateResponse, decodeStoredDraftSlot, decodeStoredString } from '../shared/boundary-decoders';
import type { DraftSyncSnapshot } from '@fantasy-draft/shared/sync';
import { localWebAppBase } from '../shared/local-urls';
import {
  DEFAULT_WEB_APP_URL,
  STORAGE_KEYS,
  type DraftRoomStatus,
  type ExtensionState,
  type ExtensionMessage,
} from '../shared/types';

const frame = document.getElementById('sidepanel-frame') as HTMLIFrameElement;
const loadingState = document.getElementById('loading-state') as HTMLDivElement;
const errorState = document.getElementById('error-state') as HTMLDivElement;
const retryButton = document.getElementById('retry-frame') as HTMLButtonElement;
const openWebAppButton = document.getElementById('open-webapp') as HTMLButtonElement;
const pairingState = document.getElementById('pairing-state') as HTMLDivElement;
document.getElementById('open-pairing')?.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });

let draftStatus: DraftRoomStatus = { isInDraftRoom: false };
let syncSnapshot: DraftSyncSnapshot | null = null;
let webAppUrl = DEFAULT_WEB_APP_URL;
let currentFrameUrl = '';
let loadTimeout: number | null = null;

function getDraftContextUrl(pathname: '/sidepanel' | '/draft'): string {
  const url = new URL(webAppUrl);
  url.pathname = pathname;
  url.search = '';
  url.hash = '';

  const draftPosition = draftStatus.myDraftSlot;
  if (draftPosition !== undefined) {
    url.searchParams.set('position', String(draftPosition));
  }

  const provider = draftStatus.provider ?? syncSnapshot?.provider ?? 'espn';
  url.searchParams.set('provider', provider);
  const draftId = draftStatus.draftId ?? syncSnapshot?.draftId;
  if (draftId) {
    url.searchParams.set(provider === 'yahoo' ? 'leagueId' : 'draftId', draftId);
  }

  return url.toString();
}

function clearLoadTimeout(): void {
  if (loadTimeout !== null) {
    window.clearTimeout(loadTimeout);
    loadTimeout = null;
  }
}

function showLoadingState(): void {
  loadingState.hidden = false;
  errorState.hidden = true;
}

function showErrorState(): void {
  loadingState.hidden = true;
  errorState.hidden = false;
}

function loadSidePanel(force = false): void {
  const nextUrl = getDraftContextUrl('/sidepanel');
  if (!force && nextUrl === currentFrameUrl) return;

  currentFrameUrl = nextUrl;
  showLoadingState();
  clearLoadTimeout();
  loadTimeout = window.setTimeout(() => {
    showErrorState();
  }, 8_000);
  frame.src = force
    ? `${nextUrl}${nextUrl.includes('?') ? '&' : '?'}retry=${String(Date.now())}`
    : nextUrl;
}

async function readExtensionState(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.WEB_APP_URL,
    STORAGE_KEYS.MY_PICK_POSITION,
    STORAGE_KEYS.SYNC_TOKEN,
  ]);
  pairingState.hidden = Boolean(stored[STORAGE_KEYS.SYNC_TOKEN]);
  const storedWebAppUrl = decodeOrNull(decodeStoredString, stored[STORAGE_KEYS.WEB_APP_URL]);
  if (storedWebAppUrl !== null) {
    try {
      webAppUrl = localWebAppBase(storedWebAppUrl);
    } catch {
      webAppUrl = DEFAULT_WEB_APP_URL;
    }
  }

  const storedPosition = decodeOrNull(decodeStoredDraftSlot, stored[STORAGE_KEYS.MY_PICK_POSITION]);
  if (storedPosition !== null) draftStatus = { ...draftStatus, myDraftSlot: storedPosition };

  const response: unknown = await chrome.runtime.sendMessage({ type: 'GET_DRAFT_STATUS' });
  let data: ExtensionState;
  try { data = decodeExtensionStateResponse(response).data; } catch (error) {
    console.warn('[Fantasy Draft] Rejected background draft state:', error);
    return;
  }

  draftStatus = data.status;
  if ('snapshot' in data) {
    syncSnapshot = data.snapshot ?? null;
  }
}

function handleMessage(value: unknown): void {
  let message: ExtensionMessage;
  try { message = decodeExtensionMessage(value); } catch (error) {
    console.warn('[Fantasy Draft] Rejected extension message:', error);
    return;
  }
  if (message.type !== 'SYNC_STATE') return;
  draftStatus = message.data.status;
  if ('snapshot' in message.data) syncSnapshot = message.data.snapshot ?? null;
  loadSidePanel();
}

async function openFullDraftRoom(): Promise<void> {
  await chrome.tabs.create({ url: getDraftContextUrl('/draft') });
}

frame.addEventListener('load', () => {
  clearLoadTimeout();
  loadingState.hidden = true;
  errorState.hidden = true;
});
frame.addEventListener('error', showErrorState);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STORAGE_KEYS.SYNC_TOKEN in changes) {
    pairingState.hidden = Boolean(changes[STORAGE_KEYS.SYNC_TOKEN]?.newValue);
  }
});
retryButton.addEventListener('click', () => { loadSidePanel(true); });
openWebAppButton.addEventListener('click', () => { void openFullDraftRoom(); });
chrome.runtime.onMessage.addListener(handleMessage);

void readExtensionState()
  .catch(() => undefined)
  .finally(() => { loadSidePanel(); });
