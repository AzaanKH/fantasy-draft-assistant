import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { fetchJson } from './effect-runtime.js';

type Handler = (request: IncomingMessage, response: ServerResponse, hit: number) => void;
const servers: (() => Promise<void>)[] = [];

async function serve(handler: Handler) {
  let hits = 0;
  let closedConnections = 0;
  const server = createServer((request, response) => {
    request.socket.once('close', () => { closedConnections += 1; });
    handler(request, response, ++hits);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => { resolve(); }); }));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}/data`, hits: () => hits, closed: () => closedConnections };
}

afterEach(async () => { await Promise.all(servers.splice(0).map((stop) => stop())); });

const run = <T>(url: string, timeoutMs = 2000) =>
  Effect.runPromise(Effect.result(fetchJson<T>(url, { label: 'Test', timeoutMs })));

describe('fetchJson', () => {
  it('retries rate limits after the Retry-After delay, then succeeds', async () => {
    const server = await serve((_request, response, hit) => {
      if (hit === 1) response.writeHead(429, { 'retry-after': '1' }).end('slow down');
      else response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
    const started = Date.now();
    const result = await run<{ ok: boolean }>(server.url);
    expect(result).toMatchObject({ _tag: 'Success', success: { ok: true } });
    expect(server.hits()).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('does not retry client errors', async () => {
    const server = await serve((_request, response) => { response.writeHead(404).end('missing'); });
    const result = await run(server.url);
    expect(result).toMatchObject({ _tag: 'Failure', failure: { status: 404 } });
    expect(server.hits()).toBe(1);
  });

  it('times out a stalled body and closes its connection', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"players": [');
    });
    const result = await run(server.url, 150);
    expect(result).toMatchObject({ _tag: 'Failure', failure: { message: expect.stringContaining('timed out after 150ms') as string } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.closed()).toBe(1);
  });

  it('times out a stalled error body and closes its connection', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.write('overloaded');
    });
    const result = await run(server.url, 150);
    expect(result).toMatchObject({ _tag: 'Failure' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.hits()).toBe(1);
    expect(server.closed()).toBe(1);
  });
});
