import { afterEach, describe, expect, it, vi } from 'vitest';
import { POSITIONS } from '@fantasy-draft/shared/league';
import { fetchLeagueSurvivalModel } from './league-survival-model';

function createModel() {
  return {
    generatedAt: '2026-09-16T00:00:00Z',
    modelVersion: 'test',
    leagueName: 'Primary League',
    seasons: [2025],
    sampleSize: 140,
    positions: Object.fromEntries(POSITIONS.map((position) => [position, {
      position,
      leagueMedianPick: 50,
      sleeperMedianPick: 55,
      pickPremium: 5,
      top50RateDelta: 0,
      top100RateDelta: 0,
      sampleSize: 20,
    }])),
  };
}

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchLeagueSurvivalModel', () => {
  it('returns a runtime-validated model', async () => {
    const model = createModel();
    const fetchMock = respond(model);
    await expect(fetchLeagueSurvivalModel()).resolves.toEqual({ ...model, warnings: [] });
    expect(fetchMock).toHaveBeenCalledWith('/data/league-history/survival-model.json', expect.anything());
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats a missing optional model as null', async () => {
    respond(null, 404);
    await expect(fetchLeagueSurvivalModel()).resolves.toBeNull();
  });

  it('preserves HTTP errors', async () => {
    respond(null, 503);
    await expect(fetchLeagueSurvivalModel()).rejects.toThrow('Failed to load league survival model: 503');
  });

  it.each([
    null,
    {},
  ])('rejects invalid shapes instead of caching them', async (payload) => {
    respond(payload);
    await expect(fetchLeagueSurvivalModel()).rejects.toThrow('Invalid league survival model shape');
  });

  it('drops malformed summaries and samples while retaining usable league evidence', async () => {
    const model = createModel();
    respond({ ...model, positions: { ...model.positions, QB: {} }, historicalPickNumbers: { QB: ['invalid'], RB: [15, 20] },
      adpBuckets: [{}], managerTendencies: [{}] });
    const data = await fetchLeagueSurvivalModel();
    expect(data?.positions.QB).toBeUndefined();
    expect(data?.positions.RB).toEqual(model.positions.RB);
    expect(data?.historicalPickNumbers).toEqual({ RB: [15, 20] });
    expect(data?.adpBuckets).toEqual([]);
    expect(data?.managerTendencies).toEqual([]);
    expect(data?.warnings).toEqual(['Dropped 1 invalid survival QB rows.', 'Dropped 1 invalid historical QB rows.',
      'Dropped 1 invalid survival bucket rows.', 'Dropped 1 invalid survival manager rows.']);
  });

  it('propagates JSON parsing failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{invalid')));
    await expect(fetchLeagueSurvivalModel()).rejects.toThrow();
  });
});
