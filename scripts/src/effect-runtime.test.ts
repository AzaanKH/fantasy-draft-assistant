import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { fetchJson, parseRetryAfter } from './effect-runtime.js';

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

  it('fails without retrying when Retry-After asks for a longer wait than allowed', async () => {
    const server = await serve((_request, response) => { response.writeHead(429, { 'retry-after': '120' }).end('slow down'); });
    const started = Date.now();
    const result = await run(server.url);
    expect(result).toMatchObject({ _tag: 'Failure', failure: { status: 429, retryAfterMs: 120_000 } });
    expect(server.hits()).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
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

describe('parseRetryAfter', () => {
  const now = Date.parse('Sat, 03 Oct 2026 12:00:00 GMT');

  it('reads delay-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000);
  });

  it('reads each HTTP-date format as UTC', () => {
    expect(parseRetryAfter('Sat, 03 Oct 2026 12:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Saturday, 03-Oct-26 12:00:30 GMT', now)).toBe(30_000);
    // asctime has no zone; Date.parse would read it in the machine's local time.
    expect(parseRetryAfter('Sat Oct  3 12:00:30 2026', now)).toBe(30_000);
  });

  it('reads an RFC 850 two-digit year more than 50 years ahead as the past century', () => {
    expect(parseRetryAfter('Monday, 03-Oct-50 12:00:00 GMT', now)).toBe(Date.UTC(2050, 9, 3, 12) - now);
    expect(parseRetryAfter('Sunday, 03-Oct-77 12:00:00 GMT', now)).toBe(500);
    // Fifty years ahead to the second is still ahead; one second more is the past century.
    expect(parseRetryAfter('Monday, 03-Oct-76 12:00:00 GMT', now)).toBe(Date.UTC(2076, 9, 3, 12) - now);
    expect(parseRetryAfter('Sunday, 03-Oct-76 12:00:01 GMT', now)).toBe(500);
  });

  it('treats delay-seconds too large for a number as longer than any limit', () => {
    expect(parseRetryAfter('9'.repeat(330), now)).toBe(Infinity);
  });

  it('waits a minimum delay for zero or past dates', () => {
    expect(parseRetryAfter('0', now)).toBe(500);
    expect(parseRetryAfter('Sat, 03 Oct 2026 11:00:00 GMT', now)).toBe(500);
  });

  it('ignores missing and malformed values', () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('', now)).toBeUndefined();
    expect(parseRetryAfter('-5', now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter('Sat, 03 Foo 2026 12:00:30 GMT', now)).toBeUndefined();
  });

  it('ignores dates with out-of-range fields instead of rolling them over', () => {
    expect(parseRetryAfter('Sat, 03 Oct 2026 12:00:99 GMT', now)).toBeUndefined();
    expect(parseRetryAfter('Sat, 03 Oct 2026 12:60:00 GMT', now)).toBeUndefined();
    expect(parseRetryAfter('Sat, 03 Oct 2026 24:00:00 GMT', now)).toBeUndefined();
    expect(parseRetryAfter('Tue, 31 Feb 2026 12:00:00 GMT', now)).toBeUndefined();
    expect(parseRetryAfter('Monday, 31-Apr-50 12:00:00 GMT', now)).toBeUndefined();
    expect(parseRetryAfter('Sat, 03 Oct 2026 12:00:60 GMT', now)).toBe(60_000);
  });
});
