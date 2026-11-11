import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WEB_APP_URL, STORAGE_KEYS } from '../shared/types';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_STORAGE_ACTIVATION', 'v1');
  document.body.innerHTML = `
    <iframe id="sidepanel-frame"></iframe>
    <div id="loading-state"></div>
    <div id="error-state"><strong id="error-title">Web app unavailable</strong><span id="error-detail">Run the local web app.</span></div>
    <div id="pairing-state"></div>
    <button id="use-canonical" hidden></button><button id="retry-frame"></button><button id="open-webapp"></button><small id="error-hint" hidden></small>
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

  it('leaves a fresh detected draft slot unconfirmed when no hint exists', async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn() } },
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true, data: { picks: [], status: { isInDraftRoom: true, provider: 'sleeper', draftId: 'fresh-draft' } } }), onMessage: { addListener: vi.fn() } },
    });
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.querySelector('iframe')?.src).toBe(`${DEFAULT_WEB_APP_URL}/sidepanel?provider=sleeper&draftId=fresh-draft`); });
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

describe('open full draft room', () => {
  function stubChrome(storedUrl: string) {
    const create = vi.fn().mockResolvedValue({ id: 9 });
    vi.stubGlobal('chrome', {
      // Paired, so the frame's own loading and error states are the visible overlay (pairing would cover them).
      storage: { local: { get: vi.fn().mockResolvedValue({ [STORAGE_KEYS.WEB_APP_URL]: storedUrl, [STORAGE_KEYS.SYNC_TOKEN]: 'paired' }) }, onChanged: { addListener: vi.fn() } },
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true, data: { status: { isInDraftRoom: true, provider: 'sleeper', draftId: '77', myDraftSlot: 3 } } }), onMessage: { addListener: vi.fn() } },
      permissions: { contains: vi.fn().mockResolvedValue(false) },
      tabs: { create, remove: vi.fn().mockResolvedValue(undefined) },
    });
    return create;
  }

  it('opens the configured web app draft room without workspace storage', async () => {
    const create = stubChrome('http://127.0.0.1:3000');
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.querySelector('iframe')?.src).toContain('/sidepanel?'); });
    document.getElementById('open-webapp')?.click();
    expect(create).toHaveBeenCalledWith({ url: 'http://127.0.0.1:3000/draft?position=3&provider=sleeper&draftId=77' });
  });

  it('opens the canonical-origin draft room with workspace storage instead of reloading the panel', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const { LOCAL_PORTS } = await import('../shared/local-config');
    const create = stubChrome('http://127.0.0.1:3000');
    await import('./sidepanel');
    // The sharing check fails (no host permission), leaving the error state's buttons visible.
    await vi.waitFor(() => { expect(document.getElementById('error-state')?.hidden).toBe(false); });
    document.getElementById('open-webapp')?.click();
    await vi.waitFor(() => { expect(create).toHaveBeenCalledOnce(); });
    expect(create).toHaveBeenCalledWith({ url: `${LOCAL_PORTS.webOrigin}/draft?position=3&provider=sleeper&draftId=77` });
  });
});

describe('storage check failures', () => {
  function stubChrome(storedUrl: string, allowed: boolean) {
    vi.stubGlobal('chrome', {
      // Paired, so the frame's own loading and error states are the visible overlay (pairing would cover them).
      storage: { local: { get: vi.fn().mockResolvedValue({ [STORAGE_KEYS.WEB_APP_URL]: storedUrl, [STORAGE_KEYS.SYNC_TOKEN]: 'paired' }) }, onChanged: { addListener: vi.fn() } },
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true, data: { status: { isInDraftRoom: false } } }), onMessage: { addListener: vi.fn() } },
      permissions: { contains: vi.fn().mockResolvedValue(allowed) },
      tabs: { create: vi.fn().mockResolvedValue({ id: 9 }), remove: vi.fn().mockResolvedValue(undefined) },
    });
  }
  const shown = () => ({ title: document.getElementById('error-title')?.textContent, detail: document.getElementById('error-detail')?.textContent });

  it('tells the user to switch to the canonical origin when the panel points elsewhere', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const { LOCAL_PORTS } = await import('../shared/local-config');
    stubChrome('http://127.0.0.1:3000', true);
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.getElementById('error-state')?.hidden).toBe(false); });
    expect(shown().title).toBe(`Use the web app at ${LOCAL_PORTS.webOrigin}`);
    expect(shown().detail).toContain('change the web app address in the extension options');
    expect(document.getElementById('use-canonical')?.hidden).toBe(false);
  });

  it('tells the user to allow site access when host permission is missing', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const { LOCAL_PORTS } = await import('../shared/local-config');
    stubChrome(LOCAL_PORTS.webOrigin, false);
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.getElementById('error-state')?.hidden).toBe(false); });
    expect(shown().title).toBe('Allow site access for the web app');
    expect(shown().detail).toContain(`allow site access for ${LOCAL_PORTS.webOrigin}`);
  });
});

describe('origin-error recovery', () => {
  function stubChrome(storedUrl: string, openTabs: { id: number; windowId: number; url: string }[] = []) {
    const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
    let stored: Record<string, unknown> = { [STORAGE_KEYS.WEB_APP_URL]: storedUrl, [STORAGE_KEYS.SYNC_TOKEN]: 'paired' };
    const api = {
      storage: {
        local: {
          get: vi.fn(() => Promise.resolve(stored)),
          set: vi.fn((values: Record<string, unknown>) => {
            stored = { ...stored, ...values };
            for (const listener of listeners) listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local');
            return Promise.resolve();
          }),
        },
        onChanged: { addListener: vi.fn((listener: (typeof listeners)[number]) => { listeners.push(listener); }) },
      },
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true, data: { status: { isInDraftRoom: true, provider: 'sleeper', draftId: '77', myDraftSlot: 3 } } }), onMessage: { addListener: vi.fn() } },
      permissions: { contains: vi.fn().mockResolvedValue(true) },
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 9 }), remove: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(openTabs), update: vi.fn().mockResolvedValue({}),
      },
      windows: { update: vi.fn().mockResolvedValue({}) },
      setStored: (next: Record<string, unknown>) => { stored = { ...stored, ...next }; },
      clearStored: (key: string) => { stored = Object.fromEntries(Object.entries(stored).filter(([name]) => name !== key)); },
    };
    vi.stubGlobal('chrome', api);
    return api;
  }

  it('falls back to the default address when the stored custom address is cleared, not the old one', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const api = stubChrome('http://127.0.0.1:3000');
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.getElementById('error-state')?.hidden).toBe(false); });
    api.clearStored(STORAGE_KEYS.WEB_APP_URL);
    document.getElementById('retry-frame')?.click();
    await vi.waitFor(() => { expect(document.querySelector('iframe')?.src.startsWith(`${DEFAULT_WEB_APP_URL}/sidepanel?`)).toBe(true); });
  });

  it('focuses an open app tab instead of opening another, and does not re-run an origin check that cannot pass', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const { LOCAL_PORTS } = await import('../shared/local-config');
    const api = stubChrome('http://127.0.0.1:3000', [{ id: 4, windowId: 2, url: `${LOCAL_PORTS.webOrigin}/draft?position=3&provider=sleeper&draftId=77&tab=pool` }]);
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.getElementById('error-state')?.hidden).toBe(false); });
    const title = document.getElementById('error-title')?.textContent;
    document.getElementById('open-webapp')?.click();
    await vi.waitFor(() => { expect(api.tabs.update).toHaveBeenCalledWith(4, { active: true }); });
    expect(api.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(document.getElementById('error-title')?.textContent).toBe(title);
  });

  it('"Use <origin>" saves the canonical address and reloads against it', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const { LOCAL_PORTS } = await import('../shared/local-config');
    const api = stubChrome('http://127.0.0.1:3000');
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.getElementById('use-canonical')?.hidden).toBe(false); });
    document.getElementById('use-canonical')?.click();
    await vi.waitFor(() => { expect(api.storage.local.set).toHaveBeenCalledWith({ [STORAGE_KEYS.WEB_APP_URL]: LOCAL_PORTS.webOrigin }); });
    await vi.waitFor(() => { expect(document.querySelector('iframe')?.src.startsWith(`${LOCAL_PORTS.webOrigin}/sidepanel?`)).toBe(true); });
  });

  it('Retry re-reads the stored address, so a fix made in options takes effect', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const { LOCAL_PORTS } = await import('../shared/local-config');
    const api = stubChrome('http://127.0.0.1:3000');
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.getElementById('error-state')?.hidden).toBe(false); });
    api.setStored({ [STORAGE_KEYS.WEB_APP_URL]: LOCAL_PORTS.webOrigin });
    document.getElementById('retry-frame')?.click();
    await vi.waitFor(() => { expect(document.querySelector('iframe')?.src.startsWith(`${LOCAL_PORTS.webOrigin}/sidepanel?`)).toBe(true); });
  });
});

describe('side panel shell', () => {
  function stubChrome(storedUrl: string, openTabs: { id: number; windowId: number; url: string }[] = [], paired = true) {
    const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
    const api = {
      storage: {
        local: { get: vi.fn().mockResolvedValue({ [STORAGE_KEYS.WEB_APP_URL]: storedUrl, ...(paired ? { [STORAGE_KEYS.SYNC_TOKEN]: 'paired' } : {}) }), set: vi.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: vi.fn((listener: (typeof listeners)[number]) => { listeners.push(listener); }) },
      },
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true, data: { status: { isInDraftRoom: true, provider: 'sleeper', draftId: '77', myDraftSlot: 3 } } }), onMessage: { addListener: vi.fn() } },
      permissions: { contains: vi.fn().mockResolvedValue(true) },
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 9 }), remove: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(openTabs), update: vi.fn().mockResolvedValue({}),
      },
      windows: { update: vi.fn().mockResolvedValue({}) },
      change: (changes: Record<string, { newValue?: unknown }>) => { for (const listener of listeners) listener(changes, 'local'); },
    };
    vi.stubGlobal('chrome', api);
    return api;
  }

  it('reloads the panel when the options page saves a new web app address', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const { LOCAL_PORTS } = await import('../shared/local-config');
    const api = stubChrome('http://127.0.0.1:3000');
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.getElementById('error-state')?.hidden).toBe(false); });
    api.change({ [STORAGE_KEYS.WEB_APP_URL]: { newValue: LOCAL_PORTS.webOrigin } });
    await vi.waitFor(() => { expect(document.querySelector('iframe')?.src.startsWith(`${LOCAL_PORTS.webOrigin}/sidepanel?`)).toBe(true); });
  });

  it('navigates an open tab on another page or draft to the intended draft room', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    const { LOCAL_PORTS } = await import('../shared/local-config');
    const api = stubChrome('http://127.0.0.1:3000', [{ id: 4, windowId: 2, url: `${LOCAL_PORTS.webOrigin}/assistant?provider=sleeper&draftId=12` }]);
    await import('./sidepanel');
    await vi.waitFor(() => { expect(document.getElementById('error-state')?.hidden).toBe(false); });
    document.getElementById('open-webapp')?.click();
    await vi.waitFor(() => {
      expect(api.tabs.update).toHaveBeenCalledWith(4, { active: true, url: `${LOCAL_PORTS.webOrigin}/draft?position=3&provider=sleeper&draftId=77` });
    });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('keeps the frame inert while an overlay covers it, and makes Use <origin> the only primary action', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    stubChrome('http://127.0.0.1:3000');
    await import('./sidepanel');
    const frame = document.getElementById('sidepanel-frame');
    expect(frame?.hasAttribute('inert')).toBe(true);
    await vi.waitFor(() => { expect(document.getElementById('use-canonical')?.hidden).toBe(false); });
    expect(frame?.hasAttribute('inert')).toBe(true);
    expect(document.getElementById('retry-frame')?.classList.contains('text-link')).toBe(true);

    for (const id of ['loading-state', 'error-state', 'pairing-state']) document.getElementById(id)?.toggleAttribute('hidden', true);
    await vi.waitFor(() => { expect(frame?.hasAttribute('inert')).toBe(false); });
  });

  it('shows one overlay at a time: pairing covers the error, which is hidden and inert, and focus follows the visible one', async () => {
    vi.stubEnv('VITE_STORAGE_ACTIVATION', 'idb');
    document.getElementById('pairing-state')?.insertAdjacentHTML('beforeend', '<button id="open-pairing" type="button">Open pairing options</button>');
    const api = stubChrome('http://127.0.0.1:3000', [], false);
    await import('./sidepanel');
    const pairing = document.getElementById('pairing-state');
    const error = document.getElementById('error-state');
    const loading = document.getElementById('loading-state');
    const visible = () => [pairing, loading, error].filter((overlay) => overlay && !overlay.hidden);
    // The origin check fails underneath, but the unpaired panel shows only the pairing state.
    await vi.waitFor(() => { expect(document.getElementById('use-canonical')?.hidden).toBe(false); });
    expect(visible()).toEqual([pairing]);
    expect(error?.hasAttribute('inert')).toBe(true);
    expect(loading?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement?.id).toBe('open-pairing');

    // Pairing completes: the error it covered becomes the one visible overlay, with focus on its primary control.
    api.change({ [STORAGE_KEYS.SYNC_TOKEN]: { newValue: 'token' } });
    expect(visible()).toEqual([error]);
    expect(error?.hasAttribute('inert')).toBe(false);
    expect(pairing?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement?.id).toBe('use-canonical');
  });
});

describe('shell theme', () => {
  afterEach(() => { delete document.documentElement.dataset.theme; document.documentElement.style.colorScheme = ''; });

  it('follows the theme the app frame reports, ignoring other senders and origins, and remembers it', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn().mockResolvedValue({ [STORAGE_KEYS.PANEL_THEME]: 'dark' }), set }, onChanged: { addListener: vi.fn() } },
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true, data: { status: { isInDraftRoom: false } } }), onMessage: { addListener: vi.fn() } },
    });
    await import('./sidepanel');
    // Before the frame reports, the last remembered theme applies (the OS setting before anything is known).
    await vi.waitFor(() => { expect(document.documentElement.dataset.theme).toBe('dark'); });
    const frame = document.getElementById('sidepanel-frame') as HTMLIFrameElement;
    const origin = new URL(DEFAULT_WEB_APP_URL).origin;
    const post = (init: MessageEventInit) => { window.dispatchEvent(new MessageEvent('message', init)); };
    post({ data: { type: 'fantasy-draft:theme', theme: 'light' }, origin: 'https://example.com', source: frame.contentWindow });
    post({ data: { type: 'fantasy-draft:theme', theme: 'light' }, origin, source: window });
    expect(document.documentElement.dataset.theme).toBe('dark');
    post({ data: { type: 'fantasy-draft:theme', theme: 'light' }, origin, source: frame.contentWindow });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(set).toHaveBeenCalledWith({ [STORAGE_KEYS.PANEL_THEME]: 'light' });
  });
});

it('sizes the shell text with the design-system type tokens, never raw pixels', () => {
  // jsdom gives this module an http URL, so the files are found from the working directory (the root or extension/).
  const dir = existsSync(join(process.cwd(), 'src/sidepanel')) ? join(process.cwd(), 'src/sidepanel') : join(process.cwd(), 'extension/src/sidepanel');
  const css = readFileSync(join(dir, 'sidepanel.css'), 'utf8');
  expect(css.match(/font-size:\s*\d+px/g) ?? []).toEqual([]);
  const tokens = readFileSync(join(dir, 'tokens.css'), 'utf8');
  for (const name of ['--text-2xs', '--text-sm', '--text-base']) expect(tokens).toMatch(new RegExp(`${name}: \\d+px;`));
});
