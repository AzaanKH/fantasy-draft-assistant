import { describe, expect, it } from 'vitest';
import { parseDraftEvents } from './client';
import { fixturePick, fixtureSnapshot } from './fixtures';

function stream(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
    controller.close();
  } });
}

describe('draft SSE decoding', () => {
  it('decodes UTF-8, CRLF, comments, and multiline JSON across network chunk boundaries', async () => {
    const snapshot = fixtureSnapshot({ picks: [fixturePick(1, 1, { playerName: 'José Player' })] });
    const json = JSON.stringify({ type: 'pick', snapshot, pick: snapshot.picks[0] }, null, 2);
    const data = json.split('\n').map(line => `data: ${line}\r\n`).join('');
    const heartbeat = { type: 'heartbeat', provider: 'sleeper', draftId: 'fixture',
      lastPolledAt: 100, lastSuccessfulSyncAt: 100 };
    const events = [];
    for await (const event of parseDraftEvents(stream(`: keep-alive\r\nevent: draft\r\n${data}\r\ndata: ${JSON.stringify(heartbeat)}\r\n\r\n`, 1))) events.push(event);
    expect(events).toEqual([{ type: 'pick', snapshot, pick: snapshot.picks[0] }, heartbeat]);
  });

  it('rejects malformed JSON and invalid draft updates before emitting them', async () => {
    const consume = async (text: string) => { for await (const _event of parseDraftEvents(stream(text))) { /* consume */ } };
    await expect(consume('data: {bad json}\n\n')).rejects.toMatchObject({ code: 'INVALID_STREAM' });
    await expect(consume('data: {"type":"pick","snapshot":{}}\n\n')).rejects.toMatchObject({ code: 'INVALID_STREAM' });
  });

  it('cancels the response body when a consumer stops watching', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', snapshot: fixtureSnapshot() })}\n\n`));
    }, cancel() { cancelled = true; } });
    for await (const _event of parseDraftEvents(body)) break;
    expect(cancelled).toBe(true);
  });
});
