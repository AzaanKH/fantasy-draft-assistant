import { describe, expect, it } from 'vitest';
import { Effect, Stream } from 'effect';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DraftClient } from './client';
import { http } from '@fantasy-draft/shared/http';
import { decodeDraftSyncUpdate } from '@fantasy-draft/shared/catalog';
import { fixturePick, fixtureSnapshot } from './fixtures';

function stream(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
    controller.close();
  } });
}

const parseDraftEvents = (body: ReadableStream<Uint8Array>) => Stream.fromAsyncIterable(
  http.events('http://test.invalid/events', decodeDraftSyncUpdate,
    { timeoutMs: 1000, idleMs: 1000, maxEventBytes: 2 * 1024 * 1024, retries: 0, retryAfter: true },
    { fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) }),
  () => ({ code: 'INVALID_STREAM' }),
);

describe('draft SSE decoding', () => {
  it('decodes UTF-8, CRLF, comments, and multiline JSON across network chunk boundaries', async () => {
    const snapshot = fixtureSnapshot({ picks: [fixturePick(1, 1, { playerName: 'José Player' })] });
    const json = JSON.stringify({ type: 'pick', snapshot, pick: snapshot.picks[0] }, null, 2);
    const data = json.split('\n').map(line => `data: ${line}\r\n`).join('');
    const heartbeat = { type: 'heartbeat', provider: 'sleeper', draftId: 'fixture',
      lastPolledAt: 100, lastSuccessfulSyncAt: 100 };
    const events = await Effect.runPromise(Stream.runCollect(parseDraftEvents(
      stream(`: keep-alive\r\nevent: draft\r\n${data}\r\ndata: ${JSON.stringify(heartbeat)}\r\n\r\n`, 1))));
    expect(events).toEqual([{ type: 'pick', snapshot, pick: snapshot.picks[0] }, heartbeat]);
  });

  it('rejects malformed JSON and invalid draft updates before emitting them', async () => {
    const consume = (text: string) => Effect.runPromise(Stream.runDrain(parseDraftEvents(stream(text))));
    await expect(consume('data: {bad json}\n\n')).rejects.toMatchObject({ code: 'INVALID_STREAM' });
    await expect(consume('data: {"type":"pick","snapshot":{}}\n\n')).rejects.toMatchObject({ code: 'INVALID_STREAM' });
  });

  it('cancels the response body when a consumer stops watching', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', snapshot: fixtureSnapshot() })}\n\n`));
    }, cancel() { cancelled = true; } });
    await Effect.runPromise(Stream.runDrain(Stream.take(parseDraftEvents(body), 1)));
    expect(cancelled).toBe(true);
  });
});

describe('draft server requests', () => {
  const timeouts = { requestMs: 150, marketAdpMs: 150, connectMs: 150, idleMs: 150 };

  /** A server that sends headers and part of a body, then never finishes it. */
  async function stalledBodyServer(contentType = 'application/json', partialBody = '{"sessions": [') {
    let closed = false;
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': contentType });
      response.write(partialBody);
      request.socket.once('close', () => { closed = true; });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${String(port)}`, isClosed: () => closed,
      stop: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => { resolve(); }); }) };
  }

  it('times out a stalled response body and closes its connection', async () => {
    const server = await stalledBodyServer();
    try {
      const client = new DraftClient(server.url, 'a'.repeat(43), timeouts);
      await expect(Effect.runPromise(client.sessions())).rejects.toMatchObject({ code: 'SERVER_UNAVAILABLE' });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(server.isClosed()).toBe(true);
    } finally { await server.stop(); }
  });

  it('closes a live event connection when the consumer stops after one event', async () => {
    const server = await stalledBodyServer('text/event-stream', `data: ${JSON.stringify({ type: 'snapshot', snapshot: fixtureSnapshot() })}\n\n`);
    try {
      const client = new DraftClient(server.url, 'a'.repeat(43), timeouts);
      const events = await Effect.runPromise(Stream.runCollect(Stream.take(client.events({ id: 'sleeper:fixture', provider: 'sleeper', draftId: 'fixture' }), 1)));
      expect(events).toHaveLength(1);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(server.isClosed()).toBe(true);
    } finally { await server.stop(); }
  });

  it('ends an idle event stream and closes its connection so watch can reconnect', async () => {
    const server = await stalledBodyServer('text/event-stream', ': connected\n\n');
    try {
      const client = new DraftClient(server.url, 'a'.repeat(43), timeouts);
      const events = await Effect.runPromise(Stream.runCollect(client.events({ id: 'sleeper:fixture', provider: 'sleeper', draftId: 'fixture' })));
      expect(events).toEqual([]);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(server.isClosed()).toBe(true);
    } finally { await server.stop(); }
  });
});
