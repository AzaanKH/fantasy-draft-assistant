import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createVite, loadConfigFromFile, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { createSyncServer, type SyncServer } from './sync-server.js';
import { localApiSecurity } from './vite-security.js';

const TOKEN = 'test-only-proxy-capability-000000000000000000';
let backend: SyncServer;
let vite: ViteDevServer;
let base: string;

beforeAll(async () => {
  backend = createSyncServer({ requestToken: TOKEN });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  const root = fileURLToPath(new URL('../../web-app/', import.meta.url));
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, `${root}vite.config.ts`);
  if (!loaded) throw new Error('Missing web app configuration');
  const proxy = loaded.config.server?.proxy?.['/api'];
  if (typeof proxy !== 'object') throw new Error('Missing API proxy');
  vite = await createVite({
    ...loaded.config, configFile: false, root, logLevel: 'silent',
    plugins: loaded.config.plugins?.map(plugin =>
      plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name === 'local-api-security'
        ? localApiSecurity(() => TOKEN) : plugin),
    server: { ...loaded.config.server, host: '127.0.0.1', port: 0, proxy: { '/api': { ...proxy, target } } },
  });
  await vite.listen();
  base = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await vite?.close();
  if (backend) {
    backend.closeAllConnections();
    await new Promise<void>(resolve => backend.shutdown(() => resolve()));
  }
});

describe('actual Vite API proxy', () => {
  it('authenticates same-origin fetch and EventSource-style requests without exposing the token', async () => {
    const response = await fetch(`${base}/api/auth/check`, { headers: { Origin: base } });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(TOKEN);
    expect((await fetch(`${base}/api/auth/check`, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    const controller = new AbortController();
    try {
      const events = await fetch(`${base}/api/sync/espn/drafts/4242/events`, { signal: controller.signal });
      expect(events.status).toBe(200);
      expect(events.headers.get('content-type')).toContain('text/event-stream');
    } finally { controller.abort(); }
  });

  it('rejects a simple cross-origin POST before the backend can change state', async () => {
    const path = '/api/sync/espn/drafts/4242';
    const response = await fetch(`${base}${path}/snapshot`, {
      method: 'POST', headers: { Origin: 'http://attacker.invalid', 'Content-Type': 'text/plain' },
      body: JSON.stringify({ draft: {
        provider: 'espn', draftId: '4242', providerKey: '2026:4242', status: 'paused', type: 'snake',
        settings: { teams: 10, rounds: 16, pickTimer: 30 }, draftOrder: null,
      }, picks: [], observedAt: Date.now() }),
    });
    expect(response.status).toBe(403);
    expect(await (await fetch(`${base}${path}`)).json()).toMatchObject({ status: 'idle' });
  });

  it('rejects cross-site requests with no Origin and requests with a foreign Host', async () => {
    expect((await fetch(`${base}/api/auth/check`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    // Node fetch rewrites Host; use raw HTTP to exercise the rebinding check.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${base}/api/auth/check`, { headers: { Host: 'attacker.invalid' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
