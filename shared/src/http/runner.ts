import { parseRetryAfter } from './retry-after.js';

export interface HttpPolicy {
  readonly timeoutMs: number;
  readonly retries: number;
  readonly retryAfter: boolean;
  readonly maxRetryAfterMs?: number;
  readonly backoffMs?: (attempt: number) => number;
  readonly retryStatuses?: readonly number[];
}
export interface HttpEventPolicy extends HttpPolicy {
  readonly idleMs: number;
  readonly maxEventBytes: number;
  readonly idleTimeout?: 'end' | 'error';
}
export interface HttpOptions {
  readonly init?: RequestInit;
  readonly fetch?: typeof fetch;
  readonly random?: () => number;
  readonly now?: () => number;
}

type FailureKind = 'timeout' | 'aborted' | 'network' | 'status' | 'invalid-json' | 'invalid-stream';

function safeUrl(input: string | URL): string {
  try {
    const url = new URL(String(input));
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  } catch { return String(input).split(/[?#]/, 1)[0] ?? ''; }
}

export class HttpError extends Error {
  readonly url: string;
  constructor(
    readonly kind: FailureKind,
    url: string | URL,
    readonly status?: number,
    readonly retryAfterMs?: number,
    readonly phase: 'request' | 'body' = 'request',
  ) {
    const redacted = safeUrl(url);
    super(`HTTP ${kind}${status === undefined ? '' : ` ${status}`} for ${redacted}`);
    this.name = 'HttpError';
    this.url = redacted;
  }
}

function scope(url: string | URL, caller: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => { controller.abort(new HttpError('aborted', url)); };
  caller?.addEventListener('abort', abort, { once: true });
  if (caller?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); };
  const reset = (ms: number) => {
    clear();
    timer = setTimeout(() => { controller.abort(new HttpError('timeout', url)); }, ms);
  };
  reset(timeoutMs);
  return {
    signal: controller.signal, reset,
    close: () => { clear(); caller?.removeEventListener('abort', abort); },
  };
}

function interrupted<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { const cause: unknown = signal.reason; reject(cause instanceof Error ? cause : new Error('Request aborted')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(run).then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort); });
  });
}

function validatePolicy(policy: HttpPolicy): void {
  if (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0 || policy.timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(policy.retries) || policy.retries < 0 ||
      policy.maxRetryAfterMs !== undefined && (!Number.isFinite(policy.maxRetryAfterMs) || policy.maxRetryAfterMs < 0)) {
    throw new RangeError('HTTP policy requires a positive timeout and a nonnegative finite retry count and wait limit');
  }
}

function cancel(body: ReadableStream<Uint8Array> | null): void {
  void body?.cancel().catch(() => undefined);
}

async function readBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await interrupted(() => reader.read(), signal);
      if (signal.aborted) throw signal.reason;
      if (done) break;
      chunks.push(value); length += value.length;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

async function retryDelay(url: string | URL, policy: HttpPolicy, options: HttpOptions, error: HttpError, attempt: number): Promise<boolean> {
  if (error.kind !== 'status' || error.status === undefined || attempt >= policy.retries ||
      !(policy.retryStatuses ?? [429, 503]).includes(error.status)) return false;
  const requested = policy.retryAfter ? error.retryAfterMs : undefined;
  const limit = policy.maxRetryAfterMs ?? 10_000;
  if (requested !== undefined && requested > limit) return false;
  const base = requested ?? policy.backoffMs?.(attempt + 1) ?? (attempt + 1) * 1500;
  if (!Number.isFinite(base) || base < 0) throw new RangeError('HTTP retry delay must be finite and nonnegative');
  const delay = Math.min(2_147_483_647, base + Math.floor((options.random ?? Math.random)() * Math.min(250, base * 0.1)));
  const caller = options.init?.signal;
  if (caller?.aborted) throw new HttpError('aborted', url);
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); caller?.removeEventListener('abort', abort); reject(new HttpError('aborted', url)); };
    const timer = setTimeout(() => { caller?.removeEventListener('abort', abort); resolve(); }, delay);
    caller?.addEventListener('abort', abort, { once: true });
  });
  return true;
}

async function open(url: string | URL, policy: HttpPolicy, options: HttpOptions) {
  validatePolicy(policy);
  for (let attempt = 0; ; attempt++) {
    const deadline = scope(url, options.init?.signal, policy.timeoutMs);
    try {
      const response = await interrupted(async () => {
        const result = await (options.fetch ?? globalThis.fetch)(url, { ...options.init, signal: deadline.signal });
        if (deadline.signal.aborted) { cancel(result.body); throw deadline.signal.reason; }
        return result;
      }, deadline.signal);
      if (!response.ok) {
        cancel(response.body);
        throw new HttpError('status', url, response.status, parseRetryAfter(response.headers.get('retry-after'), (options.now ?? Date.now)()));
      }
      return { response, deadline };
    } catch (cause) {
      deadline.close();
      const error: unknown = deadline.signal.aborted ? deadline.signal.reason : cause instanceof HttpError ? cause : new HttpError('network', url);
      if (!(error instanceof HttpError) || !await retryDelay(url, policy, options, error, attempt)) throw error;
    }
  }
}

async function bytes(url: string | URL, policy: HttpPolicy, options: HttpOptions = {}): Promise<Uint8Array> {
  const { response, deadline } = await open(url, policy, options);
  try { return await readBytes(response, deadline.signal); }
  catch (cause) { throw deadline.signal.aborted ? deadline.signal.reason : cause instanceof HttpError ? cause : new HttpError('network', url, undefined, undefined, 'body'); }
  finally { deadline.close(); }
}
async function text(url: string | URL, policy: HttpPolicy, options: HttpOptions = {}): Promise<string> {
  return new TextDecoder().decode(await bytes(url, policy, options));
}
function parseJson(text: string, url: string | URL): unknown {
  try { const value: unknown = JSON.parse(text); return value; }
  catch { throw new HttpError('invalid-json', url); }
}
async function json<T>(url: string | URL, decode: (value: unknown) => T, policy: HttpPolicy, options: HttpOptions = {}): Promise<T> {
  return decode(parseJson(await text(url, policy, options), url));
}

async function* events<T>(url: string | URL, decode: (value: unknown) => T, policy: HttpEventPolicy, options: HttpOptions = {}): AsyncGenerator<T> {
  if (!Number.isFinite(policy.idleMs) || policy.idleMs <= 0 || !Number.isSafeInteger(policy.maxEventBytes) || policy.maxEventBytes <= 0) {
    throw new RangeError('HTTP events require a positive idle timeout and frame byte limit');
  }
  const { response, deadline } = await open(url, policy, options);
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    cancel(response.body); deadline.close(); throw new HttpError('invalid-stream', url);
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  deadline.signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let frameBytes = 0;
  deadline.reset(policy.idleMs);
  try {
    for (;;) {
      const result = await interrupted(() => reader.read(), deadline.signal).catch((cause: unknown) => {
        if (cause instanceof HttpError && cause.kind === 'timeout' && policy.idleTimeout === 'end') return { done: true, value: undefined };
        throw cause instanceof HttpError ? cause : new HttpError('network', url, undefined, undefined, 'body');
      });
      const { done, value } = result;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (new TextEncoder().encode(line).length + frameBytes > policy.maxEventBytes) throw new HttpError('invalid-stream', url);
        if (line === '') {
          if (data.length) {
            if (deadline.signal.aborted) throw deadline.signal.reason;
            const event = decode(parseJson(data.join('\n'), url));
            deadline.reset(policy.idleMs);
            yield event;
          }
          data = []; frameBytes = 0;
        } else if (line.startsWith('data:')) {
          const content = line.slice(5).replace(/^ /, '');
          frameBytes += new TextEncoder().encode(content).length;
          data.push(content);
        }
      }
      if (new TextEncoder().encode(buffer).length + frameBytes > policy.maxEventBytes) throw new HttpError('invalid-stream', url);
    }
  } finally {
    deadline.signal.removeEventListener('abort', abort);
    abort(); reader.releaseLock(); deadline.close();
  }
}

export const http = { json, text, bytes, events };
