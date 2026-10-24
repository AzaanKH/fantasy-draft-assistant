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
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
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


describe('side panel background projections', () => {
  function stubBackground(response: unknown): { readonly receive: (message: unknown) => void } {
    let listener: ((message: unknown) => void) | undefined;
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn() } },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(response),
        onMessage: { addListener: (handler: (message: unknown) => void) => { listener = handler; } },
      },
    });
    return { receive: (message) => { listener?.(message); } };
  }

  it('uses only the response status and draft context, without decoding draft rows', async () => {
    stubBackground({ success: true, data: {
      status: { isInDraftRoom: true, provider: 'espn', draftId: '4242', myDraftSlot: 5, status: 'unused-by-ui' },
      picks: [null],
    } });
    await import('./sidepanel');
    await vi.waitFor(() => {
      expect(document.querySelector('iframe')?.src).toBe(`${DEFAULT_WEB_APP_URL}/sidepanel?position=5&provider=espn&draftId=4242`);
    });
  });

  it('reads snapshot provider and draftId without claiming a complete sync snapshot', async () => {
    stubBackground({ success: true, data: {
      status: { isInDraftRoom: true }, snapshot: { provider: 'yahoo', draftId: 'league-42' },
    } });
    await import('./sidepanel');
    await vi.waitFor(() => {
      expect(document.querySelector('iframe')?.src).toBe(`${DEFAULT_WEB_APP_URL}/sidepanel?provider=yahoo&leagueId=league-42`);
    });
  });

  it('projects SYNC_STATE messages and rejects malformed consumed fields', async () => {
    const { receive } = stubBackground({ success: true, data: { status: { isInDraftRoom: false } } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.querySelector('iframe')?.src).toBe(`${DEFAULT_WEB_APP_URL}/sidepanel?provider=espn`); });
    receive({ type: 'SYNC_STATE', data: {
      status: { isInDraftRoom: true, provider: 'sleeper', draftId: '123', myDraftSlot: 4 },
      snapshot: null,
    } });
    const expected = `${DEFAULT_WEB_APP_URL}/sidepanel?position=4&provider=sleeper&draftId=123`;
    expect(document.querySelector('iframe')?.src).toBe(expected);
    for (const status of [{ isInDraftRoom: 'yes' }, { isInDraftRoom: true, myDraftSlot: 1.5 }, { isInDraftRoom: true, provider: 42 }]) {
      receive({ type: 'SYNC_STATE', data: { status } });
      expect(document.querySelector('iframe')?.src).toBe(expected);
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

it('ignores the development harness switch in a production side panel', async () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_PERSISTENCE_HARNESS', 'idb');
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn() } },
    runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true, data: { status: { isInDraftRoom: false } } }), onMessage: { addListener: vi.fn() } },
  });
  await import('./sidepanel');
  await vi.waitFor(() => { expect(document.querySelector('iframe')?.src).toBe(`${DEFAULT_WEB_APP_URL}/sidepanel?provider=espn`); });
});
