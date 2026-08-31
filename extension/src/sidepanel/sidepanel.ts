/**
 * Side panel bootstrap.
 *
 * The extension owns provider detection and draft-room context. The rendered
 * side panel comes from the web app so rankings, roster state, comparison
 * logic, and theme preferences stay identical across both surfaces.
 */

import { isDraftSyncSnapshot, type DraftSyncSnapshot } from '@fantasy-draft/shared';
import {
  DEFAULT_WEB_APP_URL,
  STORAGE_KEYS,
  type DraftRoomStatus,
  type ExtensionMessage,
} from '../shared/types';

const frame = document.getElementById('sidepanel-frame') as HTMLIFrameElement;
const loadingState = document.getElementById('loading-state') as HTMLDivElement;
const errorState = document.getElementById('error-state') as HTMLDivElement;
const retryButton = document.getElementById('retry-frame') as HTMLButtonElement;
const openWebAppButton = document.getElementById('open-webapp') as HTMLButtonElement;

let draftStatus: DraftRoomStatus = { isInDraftRoom: false };
let syncSnapshot: DraftSyncSnapshot | null = null;
let webAppUrl = DEFAULT_WEB_APP_URL;
let currentFrameUrl = '';
let loadTimeout: number | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
  ]);
  const storedWebAppUrl: unknown = stored[STORAGE_KEYS.WEB_APP_URL];
  if (typeof storedWebAppUrl === 'string') webAppUrl = storedWebAppUrl;

  const storedPosition: unknown = stored[STORAGE_KEYS.MY_PICK_POSITION];
  if (typeof storedPosition === 'number') {
    draftStatus = { ...draftStatus, myDraftSlot: storedPosition };
  }

  const response: unknown = await chrome.runtime.sendMessage({ type: 'GET_DRAFT_STATUS' });
  const data = isRecord(response) && response['success'] === true && isRecord(response['data'])
    ? response['data']
    : null;
  if (!data) return;

  draftStatus = isRecord(data['status'])
    ? data['status'] as unknown as DraftRoomStatus
    : draftStatus;
  syncSnapshot = isDraftSyncSnapshot(data['snapshot'])
    ? data['snapshot']
    : syncSnapshot;
}

function handleMessage(message: ExtensionMessage): void {
  if (message.type !== 'SYNC_STATE' || !message.data) return;

  draftStatus = message.data.status ?? draftStatus;
  if ('snapshot' in message.data) {
    syncSnapshot = message.data.snapshot ?? null;
  }
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
retryButton.addEventListener('click', () => { loadSidePanel(true); });
openWebAppButton.addEventListener('click', () => { void openFullDraftRoom(); });
chrome.runtime.onMessage.addListener(handleMessage);

void readExtensionState()
  .catch(() => undefined)
  .finally(() => { loadSidePanel(); });
