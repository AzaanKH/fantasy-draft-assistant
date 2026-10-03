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
}

const parseRetryAfter = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.min(10_000, Math.max(500, seconds * 1000)) : undefined;
};

/** GET JSON with a per-attempt timeout and a retry policy that honors Retry-After. */
export function fetchJson<T>(url: string | URL, options: FetchJsonOptions): Effect.Effect<T, HttpRequestError> {
  const href = String(url);
  const attempt = Effect.tryPromise({
    try: (signal) => fetch(url, { headers: options.headers, signal }),
    catch: (cause) => new HttpRequestError({
      message: `${options.label} request failed for ${href}: ${cause instanceof Error ? cause.message : String(cause)}`,
      url: href,
    }),
  }).pipe(
    Effect.flatMap((response) => response.ok
      ? Effect.tryPromise({
        try: () => response.json() as Promise<T>,
        catch: () => new HttpRequestError({ message: `${options.label} returned invalid JSON for ${href}`, url: href }),
      })
      : Effect.promise(() => response.text().catch(() => '')).pipe(Effect.flatMap((body) => Effect.fail(new HttpRequestError({
        message: `${options.label} request failed (${String(response.status)}) for ${href}${body ? `: ${body.slice(0, 200)}` : ''}`,
        url: href,
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      }))))),
    Effect.timeoutOrElse({
      duration: options.timeoutMs,
      orElse: () => Effect.fail(new HttpRequestError({
        message: `${options.label} request timed out after ${String(options.timeoutMs)}ms for ${href}`,
        url: href,
      })),
    }),
  );
  const backoffMs = options.backoffMs ?? ((n: number) => n * 1500);
  return attempt.pipe(Effect.retry({
    while: isRetryable,
    schedule: Schedule.recurs(options.retries ?? 2).pipe(
      Schedule.setInputType<HttpRequestError>(),
      Schedule.modifyDelay(({ input, attempt: n }) => Effect.succeed(Duration.millis(input.retryAfterMs ?? backoffMs(n)))),
    ),
  }));
}
