import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { getLocalSyncToken } from './local-auth.js';

export function isSameOriginApiRequest(request: IncomingMessage, port: number): boolean {
  const host = request.headers.host;
  const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  if (port === 80) allowedHosts.push('localhost', '127.0.0.1', '[::1]');
  if (!host || !allowedHosts.includes(host)) {
    return false;
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.href !== `${originUrl.origin}/` || originUrl.origin !== new URL(`http://${host}`).origin) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers['sec-fetch-site'];
  return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
}

export function localApiSecurity(getToken: () => string = getLocalSyncToken): Plugin {
  return {
    name: 'local-api-security',
    apply: 'serve',
    configureServer(server) {
      const token = getToken();
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api')) { next(); return; }
        const address = server.httpServer?.address();
        if (!address || typeof address === 'string' || !isSameOriginApiRequest(request, address.port)) {
          response.statusCode = 403;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'Cross-origin API requests are not allowed' }));
          return;
        }
        // Only validated same-origin requests gain the backend capability.
        // Keeping it on the server also authenticates native EventSource requests.
        request.headers['x-sync-token'] = token;
        request.headers.origin = new URL(`http://localhost:${String(address.port)}`).origin;
        next();
      });
    },
  };
}
