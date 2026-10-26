import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpError, type HttpPolicy } from './index.js';

const policy: HttpPolicy = { timeoutMs: 100, retries: 2, retryAfter: true };
const decode = (value: unknown): { ok: boolean } => {
  if (typeof value !== 'object' || value === null || !('ok' in value) || typeof value.ok !== 'boolean') throw new Error('Invalid payload');
  return { ok: value.ok };
};
afterEach(() => { vi.useRealTimers(); });

describe('HTTP runner deadlines and retries', () => {
  it('aborts and cancels a slow body after headers arrive', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi.fn(() => Promise.resolve(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); }, cancel,
    }))));
    const settled = http.json('https://test.invalid/slow', decode, policy, { fetch: fetcher }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(101);
    expect(cancel).toHaveBeenCalledOnce();
    expect(await settled).toMatchObject({ kind: 'timeout' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([429, 503].flatMap(status => ['2', 'Tue, 20 Oct 2026 12:00:02 GMT'].map(retryAfter => ({ status, retryAfter }))))('honors $status Retry-After $retryAfter and stops after max retries', async ({ status, retryAfter }) => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-20T12:00:00Z');
    const fetcher = vi.fn(() => Promise.resolve(new Response('', { status, headers: { 'Retry-After': retryAfter } })));
    const result = http.json('https://test.invalid/rate', decode, policy, { fetch: fetcher, random: () => 0 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const nextDelayMs = retryAfter === '2' ? 2000 : 500;
    await vi.advanceTimersByTimeAsync(nextDelayMs - 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await result).toMatchObject({ kind: 'status', status });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each(['2', 'Tue, 20 Oct 2026 12:00:02 GMT'])('retries 503 successfully after Retry-After %s', async retryAfter => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-20T12:00:00Z');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503, headers: { 'Retry-After': retryAfter } }))
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    const result = http.json('https://test.invalid/unavailable', decode, policy, { fetch: fetcher, random: () => 0 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns a typed invalid JSON failure', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response('{bad')));
    await expect(http.json('https://test.invalid/json', decode, policy, { fetch: fetcher })).rejects.toBeInstanceOf(HttpError);
    await expect(http.json('https://test.invalid/json', decode, policy, { fetch: fetcher })).rejects.toMatchObject({ kind: 'invalid-json' });
  });

  it('caller abort cancels retry waits and prevents further requests', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn(() => Promise.resolve(new Response('', { status: 503, headers: { 'Retry-After': '2' } })));
    const result = http.json('https://test.invalid/retry', decode, policy, { fetch: fetcher, init: { signal: controller.signal } }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await result).toMatchObject({ kind: 'aborted' });
  });

  it('caller abort cancels an in-flight retry body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503, headers: { 'Retry-After': '0' } }))
      .mockImplementation(() => Promise.resolve(new Response(new ReadableStream({ cancel }))));
    const result = http.json('https://test.invalid/retry', decode, { ...policy, timeoutMs: 5000 }, { fetch: fetcher, random: () => 0, init: { signal: controller.signal } }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(501);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(await result).toMatchObject({ kind: 'aborted' });
  });

  it('cancels error bodies and redacts URL credentials, query and fragment from failures', async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn(() => Promise.resolve(new Response(new ReadableStream({ cancel }), { status: 403 })));
    const result = await http.json('https://user:password@test.invalid/private?token=secret#key', decode, policy, { fetch: fetcher }).catch((error: unknown) => error);
    expect(result).toMatchObject({ kind: 'status', status: 403, url: 'https://test.invalid/private' });
    expect(String(result)).not.toMatch(/password|secret|token|#key/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not retry a decoder failure', async () => {
    const fetcher = vi.fn(() => Promise.resolve(Response.json({ wrong: true })));
    await expect(http.json('https://test.invalid/json', decode, policy, { fetch: fetcher })).rejects.toThrow('Invalid payload');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});


describe('HTTP streaming ownership', () => {
  it('aborts an SSE body on idle timeout and cancels its reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi.fn(() => Promise.resolve(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } })));
    const iterator = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 30, maxEventBytes: 1000 }, { fetch: fetcher });
    const result = iterator.next().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(31);
    expect(cancel).toHaveBeenCalled();
    expect(await result).toMatchObject({ kind: 'timeout' });
  });

  it.each([
    ['buffered', 'error'], ['buffered', 'end'], ['delayed', 'error'], ['delayed', 'end'],
    ['same chunk', 'error'], ['same chunk', 'end'],
  ] as const)('pauses the idle deadline during consumer processing for %s frames with %s policy', async (delivery, idleTimeout) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const frame = (ok: boolean) => new TextEncoder().encode(`data: {"ok":${String(ok)}}\n\n`);
    const body = new ReadableStream<Uint8Array>({ start(c) {
      controller = c;
      c.enqueue(delivery === 'same chunk'
        ? new TextEncoder().encode('data: {"ok":true}\n\ndata: {"ok":false}\n\n') : frame(true));
      if (delivery === 'buffered') c.enqueue(frame(false));
    }, cancel });
    const iterator = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 30, idleTimeout, maxEventBytes: 1000 }, {
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    });
    try {
      expect(await iterator.next()).toEqual({ done: false, value: { ok: true } });
      await vi.advanceTimersByTimeAsync(100);
      expect(cancel).not.toHaveBeenCalled();
      let settled = false;
      const next = iterator.next().then(value => { settled = true; return value; });
      if (delivery === 'delayed') {
        await vi.advanceTimersByTimeAsync(29);
        expect(settled).toBe(false);
        controller?.enqueue(frame(false));
      }
      expect(await next).toEqual({ done: false, value: { ok: false } });
      await vi.advanceTimersByTimeAsync(100);
      expect(cancel).not.toHaveBeenCalled();
      const expired = iterator.next().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(29);
      expect(cancel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await expired).toMatchObject(idleTimeout === 'end' ? { done: true } : { kind: 'timeout' });
      expect(cancel).toHaveBeenCalledOnce();
    } finally { await iterator.return(undefined); }
  });

  it.each(['error', 'end'] as const)('keeps caller abort active during a yielded event with %s policy', async idleTimeout => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new TextEncoder().encode('data: {"ok":true}\n\ndata: {"ok":false}\n\n'));
    }, cancel });
    const iterator = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 30, idleTimeout, maxEventBytes: 1000 }, {
      init: { signal: caller.signal }, fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    });
    try {
      expect(await iterator.next()).toMatchObject({ value: { ok: true } });
      await vi.advanceTimersByTimeAsync(100);
      expect(cancel).not.toHaveBeenCalled();
      caller.abort();
      expect(cancel).toHaveBeenCalledOnce();
      await expect(iterator.next()).rejects.toMatchObject({ kind: 'aborted' });
    } finally { await iterator.return(undefined); }
  });

  it('honors caller abort while a stream read is pending', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const fetcher = vi.fn(() => Promise.resolve(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } })));
    const iterator = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 1000, maxEventBytes: 1000 }, { fetch: fetcher, init: { signal: controller.signal } });
    const result = iterator.next().catch((error: unknown) => error);
    await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledOnce(); });
    controller.abort();
    expect(await result).toMatchObject({ kind: 'aborted' });
    expect(cancel).toHaveBeenCalled();
  });

  it('cancels the body on early consumer return and rejects oversized frames', async () => {
    const cancel = vi.fn();
    const fetcher = () => Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n')); }, cancel }), { headers: { 'content-type': 'text/event-stream' } }));
    const iterator = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 1000, maxEventBytes: 1000 }, { fetch: fetcher });
    expect(await iterator.next()).toMatchObject({ value: { ok: true } });
    await iterator.return(undefined);
    expect(cancel).toHaveBeenCalledOnce();
    const oversized = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 1000, maxEventBytes: 5 }, { fetch: fetcher });
    await expect(oversized.next()).rejects.toMatchObject({ kind: 'invalid-stream' });
  });
});

describe('HTTP stream regression cases', () => {
  it('types a body read failure as a network error', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n')); } });
    const iterator = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 100, maxEventBytes: 1000 }, {
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    });
    expect(await iterator.next()).toMatchObject({ value: { ok: true } });
    controller?.error(new TypeError('terminated'));
    await expect(iterator.next()).rejects.toMatchObject({ kind: 'network', phase: 'body' });
  });

  it.each([': trickle\n', 'data: {"ok":\n', ' '])('times out an incomplete event even if bytes keep arriving as %j', async chunk => {
    vi.useFakeTimers();
    let timer: ReturnType<typeof setInterval> | undefined;
    const cancel = vi.fn(() => { clearInterval(timer); });
    const body = new ReadableStream<Uint8Array>({ start(c) { timer = setInterval(() => { c.enqueue(new TextEncoder().encode(chunk)); }, 5); }, cancel });
    const iterator = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 30, maxEventBytes: 1000 }, {
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    });
    const result = iterator.next().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(31);
    try { expect(cancel).toHaveBeenCalledOnce(); }
    finally { clearInterval(timer); }
    expect(await result).toMatchObject({ kind: 'timeout' });
  });

  it('does not emit buffered frames after caller abort', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"ok":true}\n\ndata: {"ok":false}\n\n')); } });
    const iterator = http.events('https://test.invalid/events', decode, { ...policy, idleMs: 100, maxEventBytes: 1000 }, {
      init: { signal: controller.signal }, fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    });
    expect(await iterator.next()).toMatchObject({ value: { ok: true } });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ kind: 'aborted' });
  });

  it.each([['2', 2199], ['5', 5249]] as const)('adds bounded positive jitter after Retry-After %s', async (retryAfter, delayMs) => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }))
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    const result = http.json('https://test.invalid/jitter', decode, { ...policy, retries: 1 }, { fetch: fetcher, random: () => 0.999 });
    await vi.advanceTimersByTimeAsync(delayMs - 1);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
