/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../shared/types';

const TOKEN = 'test-only-capability-0000000000000000000000000';
const save = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  vi.resetModules();
  save.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset();
  document.body.innerHTML = '<form id="pair-form"><input id="pair-token"><button>Pair</button></form>' +
    '<p id="pair-status"></p><button id="forget-pairing">Forget</button>';
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => ({})), set: save,
    setAccessLevel: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
  } } });
  await import('./options');
});

afterEach(() => { vi.unstubAllGlobals(); });

function submitToken(): void {
  const input = document.querySelector('#pair-token');
  const form = document.querySelector('#pair-form');
  if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
    throw new Error('Pairing form is missing');
  }
  input.value = TOKEN;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(input.value).toBe('');
}

describe('extension pairing HTTP boundary', () => {
  it('saves the token only after the local server returns a valid acknowledgement', async () => {
    fetchMock.mockImplementation(async () => Response.json({ ok: true }));
    submitToken();
    await vi.waitFor(() => { expect(save).toHaveBeenCalledWith({ [STORAGE_KEYS.SYNC_TOKEN]: TOKEN }); });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/auth/check', expect.objectContaining({
      headers: { 'X-Sync-Token': TOKEN }, redirect: 'error',
    }));
    expect(document.querySelector('#pair-status')?.textContent).toContain('Paired.');
  });

  it.each([Response.json({ ok: 'yes' }), new Response(null, { status: 403 })])(
    'keeps failed pairing out of storage', async response => {
      fetchMock.mockResolvedValue(response);
      submitToken();
      await vi.waitFor(() => {
        expect(document.querySelector('#pair-status')?.textContent).toContain('Could not pair.');
      });
      expect(save).not.toHaveBeenCalled();
    }
  );
});
