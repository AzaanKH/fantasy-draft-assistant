import { runNodeMain } from '@fantasy-draft/shared/node';
import { http, HttpError } from '@fantasy-draft/shared/http';
export { parseRetryAfter } from '@fantasy-draft/shared/http';
import { pathToFileURL } from 'node:url';
import { Cause, Data, Effect, Exit } from 'effect';

/** True when this module is the script Node was asked to run, not an import from a test or another script. */
export function isEntryPoint(moduleUrl: string): boolean {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && moduleUrl === pathToFileURL(entryPoint).href);
}

export function runMain(program: Effect.Effect<void, unknown>, failureLabel?: string): void {
  void runNodeMain(async signal => {
    const exit = await Effect.runPromiseExit(program, { signal });
    if (Exit.isFailure(exit)) {
      if (Cause.hasInterruptsOnly(exit.cause)) process.exitCode = 130;
      else throw Cause.squash(exit.cause);
    }
  }, { failureLabel });
}

/** Wrap file or process I/O, keeping the original Error so failures print as they did before. */
export const io = <A>(run: () => Promise<A>): Effect.Effect<A, Error> => Effect.tryPromise({
  try: run,
  catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
});

/** An HTTP request that failed, timed out, or returned an error status. */
export class HttpRequestError extends Data.TaggedError('HttpRequestError')<{
  readonly message: string;
  readonly url: string;
  readonly status?: number;
  /** Server-requested wait before retrying, from Retry-After. */
  readonly retryAfterMs?: number;
}> {}

interface FetchJsonOptions {
  readonly label: string;
  readonly timeoutMs: number;
  readonly headers?: Record<string, string>;
  /** Additional attempts after the first, for retryable failures only. */
  readonly retries?: number;
  /** Delay before retry N (1-based) when the server gives no Retry-After. */
  readonly backoffMs?: (attempt: number) => number;
  /** Longest Retry-After to wait for. A longer request fails instead of retrying early. */
  readonly maxRetryAfterMs?: number;
}

export function fetchJson<T, E = never>(
  url: string | URL,
  decode: (value: unknown) => T,
  options: FetchJsonOptions,
  onDecodeError?: (cause: unknown) => E,
): Effect.Effect<T, HttpRequestError | E> {
  return Effect.tryPromise({
    try: signal => http.json(url, decode, {
      timeoutMs: options.timeoutMs,
      retries: options.retries ?? 2,
      retryAfter: true,
      backoffMs: options.backoffMs,
      maxRetryAfterMs: options.maxRetryAfterMs,
      retryStatuses: [429, ...Array.from({ length: 100 }, (_, n) => n + 500)],
    }, { init: { headers: options.headers, signal } }),
    catch: (cause): HttpRequestError | E => {
      if (!(cause instanceof HttpError) && onDecodeError) return onDecodeError(cause);
      const safe = cause instanceof HttpError ? cause.url : new HttpError('invalid-json', url).url;
      const message = cause instanceof HttpError && cause.kind === 'timeout'
        ? `${options.label} request timed out after ${String(options.timeoutMs)}ms for ${safe}`
        : cause instanceof HttpError && cause.kind === 'invalid-json'
          ? `${options.label} returned invalid JSON for ${safe}`
          : `${options.label} request failed${cause instanceof HttpError && cause.status !== undefined ? ` (${String(cause.status)})` : ''} for ${safe}`;
      return new HttpRequestError({ message, url: safe,
        ...(cause instanceof HttpError ? { status: cause.status, retryAfterMs: cause.retryAfterMs } : {}),
      });
    },
  });
}
