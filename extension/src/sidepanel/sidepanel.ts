/// <reference types="vite/client" />
/**
 * The extension owns provider detection and draft-room context. The rendered
 * side panel comes from the web app so rankings, roster state, comparison
 * logic, and theme preferences stay identical across both surfaces.
 */

import { LOCAL_PORTS } from '../shared/local-config';
import { localWebAppBase } from '../shared/local-urls';
import { DEFAULT_WEB_APP_URL, STORAGE_KEYS } from '../shared/types';

interface PanelFailure {
  readonly kind?: 'origin' | 'permission' | 'refused' | 'timeout' | 'helper';
  readonly title: string;
  readonly detail: string;
  readonly hint?: string;
}

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
const errorTitle = document.getElementById('error-title') as HTMLElement;
const errorDetail = document.getElementById('error-detail') as HTMLElement;
const errorHint = document.getElementById('error-hint');
const useCanonicalButton = document.getElementById('use-canonical') as HTMLButtonElement | null;
/** Matches storage-sharing's DEVELOPER_START_HINT; kept inline so the v1 panel never loads that chunk. */
const DEFAULT_ERROR: PanelFailure = { title: errorTitle.textContent ?? '', detail: errorDetail.textContent ?? '', hint: 'Running from source? Start it with pnpm dev:live.' };
const retryButton = document.getElementById('retry-frame') as HTMLButtonElement;
const openWebAppButton = document.getElementById('open-webapp') as HTMLButtonElement;
const pairingState = document.getElementById('pairing-state') as HTMLDivElement;
const openPairingButton = document.getElementById('open-pairing') as HTMLButtonElement | null;
openPairingButton?.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });

/**
 * The shell shows at most one overlay. Pairing comes first (nothing else works until the extension is paired), then
 * the frame's own loading or error state; a ready frame shows none. Hidden overlays are `hidden` and `inert`, so a
 * covered error can never take focus or announce its alert, and focus moves to the visible overlay's primary control.
 */
type FrameState = 'loading' | 'error' | 'ready';
let frameState: FrameState = 'loading';
let pairingRequired = !pairingState.hidden;
let visibleOverlay: HTMLElement | null = null;

function primaryControl(overlay: HTMLElement): HTMLButtonElement | null {
  if (overlay === pairingState) return openPairingButton;
  if (overlay === errorState) return useCanonicalButton && !useCanonicalButton.hidden ? useCanonicalButton : retryButton;
  return null;
}

function renderOverlays(): void {
  const next = pairingRequired ? pairingState : frameState === 'loading' ? loadingState : frameState === 'error' ? errorState : null;
  for (const overlay of [pairingState, loadingState, errorState]) {
    const shown = overlay === next;
    overlay.hidden = !shown;
    overlay.toggleAttribute('inert', !shown);
  }
  if (next === visibleOverlay) return;
  visibleOverlay = next;
  if (next) primaryControl(next)?.focus({ preventScroll: true });
}

function setFrameState(state: FrameState): void {
  frameState = state;
  renderOverlays();
}

function setPairingRequired(required: boolean): void {
  pairingRequired = required;
  renderOverlays();
}

let draftStatus: DraftStatusProjection = { isInDraftRoom: false };
let syncSnapshot: SnapshotProjection | null = null;
let webAppUrl = DEFAULT_WEB_APP_URL;
let currentFrameUrl = '';
let loadTimeout: number | null = null;
let sharingAttempt = 0;
let sharingStatus: 'pending' | 'ready' | 'error' = 'pending';
let stopSharingCheck: (() => void) | undefined;
let failureKind: PanelFailure['kind'] | null = null;

function getDraftContextUrl(pathname: '/sidepanel' | '/draft', base = webAppUrl): string {
  const url = new URL(base);
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
  setFrameState('loading');
}

/**
 * Shows the failure with its specific fix; without one, the generic "start the web app" copy. An origin
 * mismatch also offers a one-click switch to the canonical address, since retrying the same URL cannot help.
 */
function showErrorState(message: PanelFailure = DEFAULT_ERROR): void {
  failureKind = message.kind ?? null;
  errorTitle.textContent = message.title;
  errorDetail.textContent = message.detail;
  if (errorHint) {
    errorHint.textContent = message.hint ?? '';
    errorHint.hidden = !message.hint;
  }
  if (useCanonicalButton) {
    useCanonicalButton.hidden = message.kind !== 'origin';
    useCanonicalButton.textContent = `Use ${LOCAL_PORTS.webOrigin}`;
  }
  // Retrying the same address cannot fix an origin mismatch, so "Use <origin>" is the one primary action there.
  retryButton.classList.toggle('text-link', message.kind === 'origin');
  // A second failure while the error already shows still moves focus to its (possibly new) primary control.
  if (visibleOverlay === errorState) visibleOverlay = null;
  setFrameState('error');
}

function readWebAppUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_WEB_APP_URL;
  try {
    return localWebAppBase(value);
  } catch {
    return DEFAULT_WEB_APP_URL;
  }
}

function loadSidePanel(force = false): void {
  const nextUrl = getDraftContextUrl('/sidepanel');
  if (!force && nextUrl === currentFrameUrl) return;

  currentFrameUrl = nextUrl;
  showLoadingState();
  clearLoadTimeout();
  const attempt = ++sharingAttempt;
  stopSharingCheck?.();
  sharingStatus = 'pending';
  frame.removeAttribute('src');
  void import('./storage-sharing').then(({ startStorageSharing, describeStorageSharingFailure }) => {
    if (attempt !== sharingAttempt) return;
    stopSharingCheck = startStorageSharing({ frame, frameUrl: nextUrl,
      ready: () => { sharingStatus = 'ready'; setFrameState('ready'); },
      failed: error => {
        sharingStatus = 'error';
        console.warn('[Fantasy Draft] Storage sharing failed', error);
        showErrorState(describeStorageSharingFailure(error, LOCAL_PORTS.webOrigin));
      },
    });
  }).catch(() => { if (attempt === sharingAttempt) { sharingStatus = 'error'; showErrorState(); } });
}

async function readExtensionState(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.WEB_APP_URL,
    STORAGE_KEYS.MY_PICK_POSITION,
    STORAGE_KEYS.SYNC_TOKEN,
  ]);
  setPairingRequired(!stored[STORAGE_KEYS.SYNC_TOKEN]);
  const storedWebAppUrl: unknown = stored[STORAGE_KEYS.WEB_APP_URL];
  // A cleared address falls back to the default, never the address this panel loaded with.
  webAppUrl = readWebAppUrl(storedWebAppUrl);

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

/**
 * True when an open tab already shows the intended page and draft context: the same path, and every draft
 * parameter (provider, draft or league id, position) the intended URL carries. Other parameters are ignored.
 */
export function tabShowsDraftContext(tabUrl: string | undefined, intendedUrl: string): boolean {
  if (!tabUrl) return false;
  try {
    const tab = new URL(tabUrl);
    const intended = new URL(intendedUrl);
    if (tab.origin !== intended.origin || tab.pathname !== intended.pathname) return false;
    return [...intended.searchParams].every(([key, value]) => tab.searchParams.get(key) === value);
  } catch {
    return false;
  }
}

/**
 * Focuses an open web app tab on `base`'s origin (preferring the draft room) instead of opening another. A tab on
 * another page or another draft is navigated to the intended URL, so the button always lands on this draft.
 */
async function openOrFocusAppTab(base: string, url: string): Promise<void> {
  try {
    const origin = new URL(base).origin;
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    const existing = tabs.find((tab) => tabShowsDraftContext(tab.url, url))
      ?? tabs.find((tab) => tab.url && new URL(tab.url).pathname.startsWith('/draft'))
      ?? tabs[0];
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, tabShowsDraftContext(existing.url, url) ? { active: true } : { active: true, url });
      if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch {
    // Without tab access (or in tests without the API) fall back to opening a tab.
  }
  await chrome.tabs.create({ url });
}

/** Re-reads the stored address and draft context before reloading, so a changed setting takes effect. */
async function retry(): Promise<void> {
  await readExtensionState().catch(() => undefined);
  loadSidePanel(true);
}

async function openFullDraftRoom(): Promise<void> {
  // The development persistence harness opens its own canonical helper tab on retry.
  if (import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') { loadSidePanel(true); return; }
  // Draft records are per origin, and the panel's storage check needs an ordinary app tab on
  // the canonical origin. Open (or focus) the draft room there, not a configured alias with separate
  // records. Re-running the check helps only when the panel already points at that origin; an origin
  // mismatch stays until the address changes ("Use <origin>" or the options page).
  await openOrFocusAppTab(LOCAL_PORTS.webOrigin, getDraftContextUrl('/draft', LOCAL_PORTS.webOrigin));
  if (failureKind !== 'origin') loadSidePanel(true);
}

async function useCanonicalOrigin(): Promise<void> {
  webAppUrl = LOCAL_PORTS.webOrigin;
  await chrome.storage.local.set({ [STORAGE_KEYS.WEB_APP_URL]: LOCAL_PORTS.webOrigin });
  loadSidePanel(true);
}

/**
 * The frame stays inert while the pairing, loading or error state covers it, so keyboard and assistive-technology
 * users cannot reach controls hidden underneath.
 */
function syncFrameInert(): void {
  frame.toggleAttribute('inert', !pairingState.hidden || !loadingState.hidden || !errorState.hidden);
}
const overlayObserver = new MutationObserver(syncFrameInert);
for (const overlay of [pairingState, loadingState, errorState]) overlayObserver.observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
renderOverlays();
syncFrameInert();

/** The app's own theme message (see web-app features/theme/theme.ts). */
export const THEME_MESSAGE_TYPE = 'fantasy-draft:theme';

type PanelTheme = 'light' | 'dark';

function isPanelTheme(value: unknown): value is PanelTheme {
  return value === 'light' || value === 'dark';
}

/** Shows the shell (loading and error overlays) in the app's chosen theme; before anything is known, the OS decides. */
function applyPanelTheme(theme: PanelTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** Accepts a theme only from this panel's own frame on the configured web app origin. */
export function readThemeMessage(event: Pick<MessageEvent, 'data' | 'origin' | 'source'>, frameWindow: unknown, appUrl: string): PanelTheme | null {
  if (event.source !== frameWindow || frameWindow === null) return null;
  try {
    if (event.origin !== new URL(appUrl).origin) return null;
  } catch {
    return null;
  }
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== THEME_MESSAGE_TYPE) return null;
  return 'theme' in data && isPanelTheme(data.theme) ? data.theme : null;
}

window.addEventListener('message', (event) => {
  const theme = readThemeMessage(event, frame.contentWindow, webAppUrl);
  if (!theme) return;
  applyPanelTheme(theme);
  void chrome.storage.local.set({ [STORAGE_KEYS.PANEL_THEME]: theme }).catch(() => undefined);
});
void chrome.storage.local.get(STORAGE_KEYS.PANEL_THEME).then((stored) => {
  const theme: unknown = stored[STORAGE_KEYS.PANEL_THEME];
  // A message from the frame that already arrived is newer than the stored value.
  if (isPanelTheme(theme) && document.documentElement.dataset.theme === undefined) applyPanelTheme(theme);
}).catch(() => undefined);

frame.addEventListener('load', () => {
  if (sharingStatus !== 'ready') return;
  clearLoadTimeout();
  setFrameState('ready');
});
frame.addEventListener('error', () => { showErrorState(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (STORAGE_KEYS.SYNC_TOKEN in changes) {
    setPairingRequired(!changes[STORAGE_KEYS.SYNC_TOKEN]?.newValue);
  }
  // A new web app address (options page or "Use <origin>") reloads the panel against it.
  if (STORAGE_KEYS.WEB_APP_URL in changes) {
    const next = readWebAppUrl(changes[STORAGE_KEYS.WEB_APP_URL]?.newValue);
    if (next !== webAppUrl) {
      webAppUrl = next;
      loadSidePanel(true);
    }
  }
});
retryButton.addEventListener('click', () => { void retry(); });
useCanonicalButton?.addEventListener('click', () => { void useCanonicalOrigin(); });
openWebAppButton.addEventListener('click', () => { void openFullDraftRoom(); });
chrome.runtime.onMessage.addListener(handleMessage);
window.addEventListener('pagehide', () => { ++sharingAttempt; stopSharingCheck?.(); }, { once: true });

void readExtensionState()
  .catch(() => undefined)
  .finally(() => { loadSidePanel(); });
