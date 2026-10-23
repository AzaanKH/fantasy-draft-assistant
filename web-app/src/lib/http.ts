import { http, HttpError, type HttpOptions } from '@fantasy-draft/shared/http';

export const BROWSER_HTTP_POLICY = { timeoutMs: 20_000, retries: 0, retryAfter: true };

export async function requestJson<T>(
  url: string,
  decode: (value: unknown) => T,
  statusMessage: string,
  options?: HttpOptions
): Promise<T> {
  try {
    return await http.json(url, decode, BROWSER_HTTP_POLICY, options);
  } catch (error) {
    if (error instanceof HttpError && error.kind === 'status') {
      throw new Error(`${statusMessage}: ${String(error.status)}`);
    }
    throw error;
  }
}
