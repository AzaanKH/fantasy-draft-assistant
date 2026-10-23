import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { http } from '@fantasy-draft/shared/http';

const policy = { timeoutMs: 10000, retries: 0, retryAfter: false };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const forbiddenRuntimePath = pathname => /^\/(?:@vite(?:\/|$)|@react-refresh(?:\/|$)|src(?:\/|$)|node_modules(?:\/|$))/.test(pathname);
export function assertProductionEnvironment(env) {
  if (env.MODE !== 'production' || env.DEV !== false || env.PROD !== true || env.VITE_STORAGE_ACTIVATION !== 'idb' ||
      env.VITE_PERSISTENCE_HARNESS !== undefined || env.VITE_DEMO_MODE !== undefined) throw new Error('Production proof requires activation ON, MODE=production, DEV=false, PROD=true, harness/demo mode unset');
}
export async function inspectProductionBuild(dist, env) {
  assertProductionEnvironment(env);
  const files = {};
  let code = '';
  async function walk(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), file);
      else {
        const bytes = await readFile(path.join(dist, file));
        files[file] = sha256(bytes);
        if (/\.(?:html|m?js|css)$/.test(file)) {
          const text = bytes.toString();
          if (/\/@vite\/client|\/@react-refresh|vite:ws:disconnect|\/src\/main\.tsx|VITE_PERSISTENCE_HARNESS/.test(text)) throw new Error(`Development runtime found in production bytes: ${file}`);
          code += text;
        }
      }
    }
  }
  await walk(dist);
  if (!files['index.html'] || !code.includes('fantasy-draft-workspace-v2') || !code.includes('Activate IndexedDB')) throw new Error('Production build lacks the activation-ON UI');
  return { env, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))), noViteClientOrHmr: true };
}
export function createStaticHandler({ dist, fixture, log = () => {} }) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  return (request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://static.local').pathname); }
    catch { response.writeHead(400).end(); return; }
    response.on('finish', () => log('static-response', { method: request.method, path: pathname, status: response.statusCode }));
    if (forbiddenRuntimePath(pathname)) { response.writeHead(404).end('Development runtime is not served'); return; }
    if (pathname.split('/').includes('..') || pathname.includes('\\')) { response.writeHead(403).end(); return; }
    fixture(request, response, () => {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      void (async () => {
        const relative = pathname.replace(/^\/+/, '');
        const file = !relative || !path.extname(relative) ? 'index.html' : relative;
        const bytes = await readFile(path.join(dist, file));
        response.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-store');
        response.end(request.method === 'HEAD' ? undefined : bytes);
      })().catch(error => { log('static-read-error', { path: pathname, code: error.code }); response.writeHead(404).end(); });
    });
  };
}
export async function verifyProductionHttp(origin, build) {
  const verified = {};
  for (const [file, expected] of Object.entries(build.files)) {
    if (!/\.(?:html|m?js|css)$/.test(file)) continue;
    const bytes = await http.bytes(`${origin}/${file}`, policy);
    const actual = sha256(bytes);
    if (actual !== expected) throw new Error(`Served production bytes differ from build: ${file}`);
    verified[file] = actual;
  }
  const rejected = {};
  for (const pathname of ['/@vite/client', '/@react-refresh', '/src/main.tsx', '/node_modules/vite/dist/client/client.mjs']) {
    try { await http.text(`${origin}${pathname}`, policy); throw new Error(`Development path was served: ${pathname}`); }
    catch (error) { if (error.status !== 404) throw error; rejected[pathname] = 404; }
  }
  return { verified, rejected, noViteClientOrHmr: true };
}
