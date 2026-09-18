import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WEB_APP_URL, STORAGE_KEYS } from '../shared/types';

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `
    <iframe id="sidepanel-frame"></iframe>
    <div id="loading-state"></div><div id="error-state"></div>
    <div id="pairing-state"></div>
    <button id="retry-frame"></button><button id="open-webapp"></button>
  `;
});

afterEach(() => {
  document.getElementById('sidepanel-frame')?.dispatchEvent(new Event('load'));
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('side panel stored URL', () => {
  it.each([
    ['not a URL', DEFAULT_WEB_APP_URL],
    ['https://example.com', DEFAULT_WEB_APP_URL],
    ['http://localhost:3000/draft', DEFAULT_WEB_APP_URL],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'],
    [42, DEFAULT_WEB_APP_URL],
    [undefined, DEFAULT_WEB_APP_URL],
  ])('loads draft status with stored URL %s', async (storedUrl, expectedBase) => {
    const sendMessage = vi.fn().mockResolvedValue({
      success: true,
      data: {
        picks: [],
        status: { isInDraftRoom: true, provider: 'sleeper', draftId: 'draft-123', myDraftSlot: 4 },
      },
    });
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn().mockResolvedValue({ [STORAGE_KEYS.WEB_APP_URL]: storedUrl }) },
        onChanged: { addListener: vi.fn() },
      },
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
    });

    await import('./sidepanel');

    await vi.waitFor(() => {
      expect(document.querySelector('iframe')?.src).toBe(
        `${expectedBase}/sidepanel?position=4&provider=sleeper&draftId=draft-123`
      );
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_DRAFT_STATUS' });
  });

  it('retains the stored draft position when the URL and status response are invalid', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn().mockResolvedValue({
          [STORAGE_KEYS.WEB_APP_URL]: 'invalid',
          [STORAGE_KEYS.MY_PICK_POSITION]: 7,
        }) },
        onChanged: { addListener: vi.fn() },
      },
      runtime: { sendMessage: vi.fn().mockResolvedValue(null), onMessage: { addListener: vi.fn() } },
    });

    await import('./sidepanel');

    await vi.waitFor(() => {
      expect(document.querySelector('iframe')?.src).toBe(
        `${DEFAULT_WEB_APP_URL}/sidepanel?position=7&provider=espn`
      );
    });
  });
});
