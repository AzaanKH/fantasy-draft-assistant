import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FantasyProsSnapshot } from '@fantasy-draft/shared';
import { CachedFantasyProsProvider } from './fantasypros';

describe('CachedFantasyProsProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the cached snapshot', async () => {
    const snapshot: FantasyProsSnapshot = {
      metadata: {
        season: 2026,
        sourceType: 'fixture',
        source: 'fixture.json',
        refreshedAt: '2026-05-07T00:00:00.000Z',
        rankingCount: 1,
        projectionCount: 0,
        newsCount: 0,
      },
      rankings: [
        {
          rank: 1,
          name: "Ja'Marr Chase",
          position: 'WR',
          team: 'CIN',
          byeWeek: 12,
          positionalRank: 1,
          bestRank: 1,
          worstRank: 2,
          avgRank: 1.2,
        },
      ],
      projections: [],
      news: [],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => snapshot,
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CachedFantasyProsProvider('/data/test-snapshot.json');
    await expect(provider.getSnapshot()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith('/data/test-snapshot.json');
  });

  it('throws on failed fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
    );

    const provider = new CachedFantasyProsProvider('/data/missing.json');
    await expect(provider.getSnapshot()).rejects.toThrow(
      'Failed to load FantasyPros snapshot: 404'
    );
  });
});
