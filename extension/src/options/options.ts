import { DEFAULT_SYNC_SERVER_URL, STORAGE_KEYS } from '../shared/types';
import { localSyncBase } from '../shared/local-urls';

const form = document.getElementById('pair-form') as HTMLFormElement;
const input = document.getElementById('pair-token') as HTMLInputElement;
const status = document.getElementById('pair-status') as HTMLParagraphElement;
const forget = document.getElementById('forget-pairing') as HTMLButtonElement;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void pair();
});

async function pair(): Promise<void> {
  const token = input.value.trim();
  input.value = '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    status.textContent = 'Paste the complete token from pnpm sync:pair.';
    return;
  }
  const button = form.querySelector('button') as HTMLButtonElement;
  button.disabled = true;
  status.textContent = 'Checking the local connection…';
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const stored = await chrome.storage.local.get(STORAGE_KEYS.SYNC_SERVER_URL);
    const base = localSyncBase(String(stored[STORAGE_KEYS.SYNC_SERVER_URL] ?? DEFAULT_SYNC_SERVER_URL));
    const response = await fetch(`${base}/api/auth/check`, {
      headers: { 'X-Sync-Token': token }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Pairing rejected');
    await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_TOKEN]: token });
    status.textContent = 'Paired. Refresh the provider draft tab to connect.';
  } catch {
    status.textContent = 'Could not pair. Start the local app and copy a fresh token with pnpm sync:pair.';
  } finally {
    button.disabled = false;
  }
}

forget.addEventListener('click', () => {
  void chrome.storage.local.remove(STORAGE_KEYS.SYNC_TOKEN).then(() => {
    status.textContent = 'Pairing removed from this extension.';
  });
});

void chrome.storage.local.get(STORAGE_KEYS.SYNC_TOKEN).then((stored) => {
  status.textContent = stored[STORAGE_KEYS.SYNC_TOKEN] ? 'This extension has a saved pairing.' : 'This extension is not paired yet.';
});
