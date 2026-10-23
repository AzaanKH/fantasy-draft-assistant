/// <reference types="vite/client" />
/**
 * Side panel bootstrap.
 *
 * The extension owns provider detection and draft-room context. The rendered
 * side panel comes from the web app so rankings, roster state, comparison
 * logic, and theme preferences stay identical across both surfaces.
 */

import { localWebAppBase } from '../shared/local-urls';
import { DEFAULT_WEB_APP_URL, STORAGE_KEYS } from '../shared/types';

interface DraftStatusProjection {
  readonly isInDraftRoom: boolean;
  readonly provider?: string;
  readonly draftId?: string;
  readonly myDraftSlot?: number;
}

interface SnapshotProjection {
  readonly provider: string;
  readonly draftId: string;
}

interface DraftStateProjection {
  readonly status: DraftStatusProjection;
  readonly snapshot?: SnapshotProjection | null;
}

function isDraftSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isDraftStatusProjection(value: unknown): value is DraftStatusProjection {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'isInDraftRoom' in value && typeof value.isInDraftRoom === 'boolean' &&
    (!('provider' in value) || value.provider === undefined || typeof value.provider === 'string') &&
    (!('draftId' in value) || value.draftId === undefined || typeof value.draftId === 'string') &&
    (!('myDraftSlot' in value) || value.myDraftSlot === undefined || isDraftSlot(value.myDraftSlot));
}

function isSnapshotProjection(value: unknown): value is SnapshotProjection {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'provider' in value && typeof value.provider === 'string' &&
    'draftId' in value && typeof value.draftId === 'string';
}

function isDraftStateProjection(value: unknown): value is DraftStateProjection {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'status' in value && isDraftStatusProjection(value.status) &&
    (!('snapshot' in value) || value.snapshot === undefined || value.snapshot === null || isSnapshotProjection(value.snapshot));
}

const frame = document.getElementById('sidepanel-frame') as HTMLIFrameElement;
const loadingState = document.getElementById('loading-state') as HTMLDivElement;
const errorState = document.getElementById('error-state') as HTMLDivElement;
const retryButton = document.getElementById('retry-frame') as HTMLButtonElement;
const openWebAppButton = document.getElementById('open-webapp') as HTMLButtonElement;
const pairingState = document.getElementById('pairing-state') as HTMLDivElement;
document.getElementById('open-pairing')?.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });

let draftStatus: DraftStatusProjection = { isInDraftRoom: false };
let syncSnapshot: SnapshotProjection | null = null;
let webAppUrl = DEFAULT_WEB_APP_URL;
let currentFrameUrl = '';
let loadTimeout: number | null = null;
let sharingAttempt = 0;
let sharingStatus: 'pending' | 'ready' | 'error' = 'pending';
let stopSharingCheck: (() => void) | undefined;

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
  if (import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') {
    const attempt = ++sharingAttempt;
    stopSharingCheck?.();
    sharingStatus = 'pending';
    frame.removeAttribute('src');
    void import('./storage-sharing').then(({ startStorageSharing }) => {
      if (attempt !== sharingAttempt) return;
      stopSharingCheck = startStorageSharing({ frame, frameUrl: nextUrl,
        ready: () => { sharingStatus = 'ready'; loadingState.hidden = true; errorState.hidden = true; },
        failed: error => { sharingStatus = 'error'; console.warn('[Fantasy Draft] Storage sharing failed', error); showErrorState(); },
      });
    }).catch(() => { if (attempt === sharingAttempt) { sharingStatus = 'error'; showErrorState(); } });
    return;
  }
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
  const storedWebAppUrl: unknown = stored[STORAGE_KEYS.WEB_APP_URL];
  if (typeof storedWebAppUrl === 'string') {
    try {
      webAppUrl = localWebAppBase(storedWebAppUrl);
    } catch {
      webAppUrl = DEFAULT_WEB_APP_URL;
    }
  }

  const storedPosition: unknown = stored[STORAGE_KEYS.MY_PICK_POSITION];
  if (isDraftSlot(storedPosition)) draftStatus = { ...draftStatus, myDraftSlot: storedPosition };

  const response: unknown = await chrome.runtime.sendMessage({ type: 'GET_DRAFT_STATUS' });
  if (typeof response !== 'object' || response === null ||
      !('success' in response) || response.success !== true ||
      !('data' in response) || !isDraftStateProjection(response.data)) {
    console.warn('[Fantasy Draft] Rejected background draft state');
    return;
  }
  const data = response.data;

  draftStatus = data.status;
  if ('snapshot' in data) {
    syncSnapshot = data.snapshot ?? null;
  }
}

function handleMessage(value: unknown): void {
  if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'SYNC_STATE') return;
  if (!('data' in value) || !isDraftStateProjection(value.data)) {
    console.warn('[Fantasy Draft] Rejected extension message');
    return;
  }
  draftStatus = value.data.status;
  if ('snapshot' in value.data) syncSnapshot = value.data.snapshot ?? null;
  loadSidePanel();
}

async function openFullDraftRoom(): Promise<void> {
  if (import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') { loadSidePanel(true); return; }
  await chrome.tabs.create({ url: getDraftContextUrl('/draft') });
}

frame.addEventListener('load', () => {
  if (import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb' && sharingStatus !== 'ready') return;
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
if (import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') {
  window.addEventListener('pagehide', () => { ++sharingAttempt; stopSharingCheck?.(); }, { once: true });
}

void readExtensionState()
  .catch(() => undefined)
  .finally(() => { loadSidePanel(); });
