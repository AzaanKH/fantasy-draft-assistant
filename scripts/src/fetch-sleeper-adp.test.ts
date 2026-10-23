import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { fetchSleeperPlayers } from './fetch-sleeper-adp.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Sleeper player directory boundary', () => {
  it.each([
    { p1: { position: 42 } },
    { p1: { position: 'WR', full_name: 42 } },
    { p1: { position: 'WR', age: 'old' } },
  ])('rejects invalid declared player fields atomically %j', async value => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value))));
    const result = await Effect.runPromise(Effect.result(fetchSleeperPlayers));
    expect(result._tag).toBe('Failure');
  });
});
