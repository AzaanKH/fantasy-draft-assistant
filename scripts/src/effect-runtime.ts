import { pathToFileURL } from 'node:url';
import { Cause, Data, Duration, Effect, Exit, Schedule } from 'effect';

/** True when this module is the script Node was asked to run, not an import from a test or another script. */
export function isEntryPoint(moduleUrl: string): boolean {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && moduleUrl === pathToFileURL(entryPoint).href);
}

const CLEANUP_GRACE_MS = 5000;

/**
 * Run a script's program. Ctrl-C interrupts it, so scoped resources such as
 * browsers and database connections are released before the process exits.
 */
export function runMain(program: Effect.Effect<void, unknown>, failureLabel?: string): void {
  const controller = new AbortController();
  const stop = (): void => {
    // A second Ctrl-C, or cleanup that outlasts the grace period, exits immediately as before.
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
    setTimeout(() => { process.exit(130); }, CLEANUP_GRACE_MS).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  void Effect.runPromiseExit(program, { signal: controller.signal }).then((exit) => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (Exit.isSuccess(exit)) return;
    if (Cause.hasInterruptsOnly(exit.cause)) process.exit(130);
    const error = Cause.squash(exit.cause);
    if (failureLabel) console.error(failureLabel, error);
    else console.error(error);
    process.exit(1);
  });
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

/** Rate limits and server errors are worth retrying; client errors and timeouts are not. */
export const isRetryable = (error: HttpRequestError): boolean =>
  error.status === 429 || (error.status !== undefined && error.status >= 500);

export interface FetchJsonOptions {
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

const DEFAULT_MAX_RETRY_AFTER_MS = 10_000;
const MIN_RETRY_DELAY_MS = 500;

/** Retry-After is either delay-seconds or an HTTP date (RFC 9110, section 10.2.3). */
export const parseRetryAfter = (value: string | null, now: number = Date.now()): number | undefined => {
  if (value === null) return undefined;
  const trimmed = value.trim();
  // Every HTTP-date format names a day or month; this keeps Date.parse from reading '-5' as a year.
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : /[a-z]/i.test(trimmed) ? Date.parse(trimmed) - now : NaN;
  return Number.isFinite(ms) ? Math.max(MIN_RETRY_DELAY_MS, ms) : undefined;
};

/**
 * Read a body and cancel its stream if the signal aborts. Aborting fetch alone
 * does not reliably close a connection whose body is mid-read.
 */
async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const cancel = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** GET JSON with a per-attempt timeout and a retry policy that honors Retry-After. */
export function fetchJson<T>(url: string | URL, options: FetchJsonOptions): Effect.Effect<T, HttpRequestError> {
  const href = String(url);
  const failure = (message: string, details: { status?: number; retryAfterMs?: number } = {}) =>
    new HttpRequestError({ message, url: href, ...details });
  // The request and its body share one signal, so a timeout also cancels a stalled body.
  const attempt = Effect.tryPromise({
    try: async (signal) => {
      let response: Response;
      try {
        response = await fetch(url, { headers: options.headers, signal });
      } catch (cause) {
        throw failure(`${options.label} request failed for ${href}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      const body = await readBody(response, signal);
      if (!response.ok) {
        throw failure(`${options.label} request failed (${String(response.status)}) for ${href}${body ? `: ${body.slice(0, 200)}` : ''}`, {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        });
      }
      try {
        return JSON.parse(body) as T;
      } catch {
        throw failure(`${options.label} returned invalid JSON for ${href}`);
      }
    },
    catch: (cause) => cause instanceof HttpRequestError
      ? cause
      : failure(`${options.label} request failed for ${href}: ${cause instanceof Error ? cause.message : String(cause)}`),
  }).pipe(
    Effect.timeoutOrElse({
      duration: options.timeoutMs,
      orElse: () => Effect.fail(failure(`${options.label} request timed out after ${String(options.timeoutMs)}ms for ${href}`)),
    }),
  );
  const backoffMs = options.backoffMs ?? ((n: number) => n * 1500);
  const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  return attempt.pipe(Effect.retry({
    while: (error) => isRetryable(error) && (error.retryAfterMs ?? 0) <= maxRetryAfterMs,
    schedule: Schedule.recurs(options.retries ?? 2).pipe(
      Schedule.setInputType<HttpRequestError>(),
      Schedule.modifyDelay(({ input, attempt: n }) => Effect.succeed(Duration.millis(input.retryAfterMs ?? backoffMs(n)))),
    ),
  }));
}
