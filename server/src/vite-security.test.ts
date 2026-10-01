import { afterEach, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import type { IncomingMessage } from 'node:http';
import { isSameOriginApiRequest, localApiSecurity } from './vite-security.js';

let server: ViteDevServer | undefined;
afterEach(async () => { await server?.close(); });

it('accepts canonical port-80 origins only for the exact loopback hosts', () => {
  const request = (host: string, origin: string): IncomingMessage => ({
    headers: { host, origin, 'sec-fetch-site': 'same-origin' },
  }) as IncomingMessage;
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    expect(isSameOriginApiRequest(request(host, `http://${host}`), 80)).toBe(true);
    expect(isSameOriginApiRequest(request(`${host}:80`, `http://${host}`), 80)).toBe(true);
    expect(isSameOriginApiRequest(request(host, `http://${host}:80`), 80)).toBe(true);
    expect(isSameOriginApiRequest(request(host, `http://${host}`), 3000)).toBe(false);
  }
  for (const host of ['attacker.invalid', 'localhost.attacker.invalid', '127.0.0.2', 'localhost:3000']) {
    expect(isSameOriginApiRequest(request(host, `http://${host}`), 80)).toBe(false);
  }
  for (const origin of ['http://127.0.0.1', 'https://localhost', 'http://localhost:3000', 'http://localhost/path', 'http://user@localhost', 'null']) {
    expect(isSameOriginApiRequest(request('localhost:80', origin), 80)).toBe(false);
  }
});

it('authenticates only same-origin requests using the actual web port', async () => {
  server = await createServer({ configFile: false, root: process.cwd(),
    server: { host: '127.0.0.1', port: 0, strictPort: true },
    plugins: [localApiSecurity(() => 'private-test-token'), {
      name: 'capture-proxy-input', configureServer(vite) {
        vite.middlewares.use('/api/probe', (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ origin: req.headers.origin, token: req.headers['x-sync-token'] }));
        });
      },
    }],
  });
  await new Promise<void>((resolve, reject) => {
    server!.httpServer!.once('error', reject);
    server!.httpServer!.listen(0, '127.0.0.1', resolve);
  });
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const base = `http://127.0.0.1:${String(address.port)}`;
  const response = await fetch(`${base}/api/probe`, { headers: { Origin: base, 'X-Sync-Token': 'untrusted' } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ origin: `http://localhost:${String(address.port)}`, token: 'private-test-token' });
  for (const origin of ['http://localhost:3000', 'https://attacker.invalid']) {
    expect((await fetch(`${base}/api/probe`, { headers: { Origin: origin } })).status).toBe(403);
  }
});
