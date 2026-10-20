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

  it.each(['2', 'Tue, 20 Oct 2026 12:00:02 GMT'])('honors Retry-After %s and stops after max retries', async retryAfter => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-20T12:00:00Z');
    const fetcher = vi.fn(() => Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': retryAfter } })));
    const result = http.json('https://test.invalid/rate', decode, policy, { fetch: fetcher, random: () => 0 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const nextDelayMs = retryAfter === '2' ? 2000 : 500;
    await vi.advanceTimersByTimeAsync(nextDelayMs);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await result).toMatchObject({ kind: 'status', status: 429 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
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
