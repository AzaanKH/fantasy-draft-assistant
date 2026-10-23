import type { FetchJson } from '../sync-adapter.js';

export type FixtureFetchJson = (url: string, signal: AbortSignal, init?: RequestInit) => Promise<unknown>;

export function fixtureFetchJson(fixture: FixtureFetchJson): FetchJson {
  return async (url, signal, decode, init) => decode(await fixture(url, signal, init));
}
