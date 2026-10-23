import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSeasonHistoryColumn } from './contract-source-schema.js';
import { getSourceUpdatedAt } from './refresh-contracts.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('contract source provenance', () => {
  it('uses the contract asset date before the release date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      updated_at: '2026-09-01', assets: [{ name: 'historical_contracts.parquet', updated_at: '2026-09-02' }],
    })));
    await expect(getSourceUpdatedAt()).resolves.toBe('2026-09-02');
  });

  it('keeps non-successful provenance optional without decoding its body', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 503 })));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getSourceUpdatedAt()).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it.each(['{invalid', JSON.stringify({ assets: 'invalid' })])('warns and omits invalid provenance %s', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getSourceUpdatedAt()).resolves.toBeNull();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Contract source provenance is unavailable'));
  });

  it('keeps transport failures visible to the refresh command', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(getSourceUpdatedAt()).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('contract refresh source schema', () => {
  it('uses the current nflverse season-history column', () => {
    expect(
      resolveSeasonHistoryColumn([
        'player',
        'cols',
        'season_history',
      ])
    ).toBe('season_history');
  });

  it('supports the legacy nflverse column', () => {
    expect(
      resolveSeasonHistoryColumn(['player', 'cols'])
    ).toBe('cols');
  });

  it('rejects an unknown contract schema', () => {
    expect(() =>
      resolveSeasonHistoryColumn(['player', 'contract_history'])
    ).toThrow(/season_history nor legacy cols/);
  });
});
