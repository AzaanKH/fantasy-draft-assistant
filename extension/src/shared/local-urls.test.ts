import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('extension targets for this build', () => {
  it('accepts canonical HTTP origins when a configured port is 80', async () => {
    vi.stubGlobal('__DRAFT_LOCAL_PORTS__', { webPort: 80, apiPort: 81 });
    const { localWebAppBase, localSyncBase } = await import('./local-urls');
    expect(localWebAppBase('http://localhost:80')).toBe('http://localhost');
    expect(localWebAppBase('http://127.0.0.1')).toBe('http://127.0.0.1');
    expect(() => localSyncBase('http://localhost')).toThrow();
  });

  it.each([[3000, 3001], [3100, 3101]])('restricts web %i and API %i to exact loopback origins', async (webPort, apiPort) => {
    vi.stubGlobal('__DRAFT_LOCAL_PORTS__', { webPort, apiPort, webOrigin: `http://localhost:${webPort}` });
    const { localSyncBase, localWebAppBase } = await import('./local-urls');
    const { DEFAULT_SYNC_SERVER_URL, DEFAULT_WEB_APP_URL } = await import('./types');
    expect(localSyncBase(DEFAULT_SYNC_SERVER_URL)).toBe(`http://localhost:${apiPort}`);
    expect(localWebAppBase(DEFAULT_WEB_APP_URL)).toBe(`http://localhost:${webPort}`);
    expect(localSyncBase(`http://127.0.0.1:${apiPort}/`)).toBe(`http://127.0.0.1:${apiPort}`);
    for (const bad of [`http://localhost:${apiPort === 3001 ? 3101 : 3001}`, `https://localhost:${apiPort}`,
      `http://example.com:${apiPort}`, `http://localhost.evil:${apiPort}`, `http://user@localhost:${apiPort}`,
      `http://localhost:${apiPort}/api`, `http://localhost:${apiPort}?x=1`, `http://localhost:${apiPort}#x`]) {
      expect(() => localSyncBase(bad)).toThrow();
    }
    expect(() => localWebAppBase(`http://localhost:${webPort === 3000 ? 3100 : 3000}`)).toThrow();
  });
});
