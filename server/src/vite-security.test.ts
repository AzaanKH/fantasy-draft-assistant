import { afterEach, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { localApiSecurity } from './vite-security.js';

let server: ViteDevServer | undefined;
afterEach(async () => { await server?.close(); });

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
  await server.listen();
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
