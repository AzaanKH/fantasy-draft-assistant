import { afterEach, describe, expect, it, vi } from 'vitest';
import { POSITIONS } from '@fantasy-draft/shared';
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

function respond(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchLeagueSurvivalModel', () => {
  it('returns a runtime-validated model', async () => {
    const model = createModel();
    respond(model);
    await expect(fetchLeagueSurvivalModel()).resolves.toEqual(model);
    expect(fetch).toHaveBeenCalledWith('/data/league-history/survival-model.json');
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
    { ...createModel(), positions: {} },
    { ...createModel(), historicalPickNumbers: { QB: ['invalid'] } },
  ])('rejects invalid shapes instead of caching them', async (payload) => {
    respond(payload);
    await expect(fetchLeagueSurvivalModel()).rejects.toThrow('Invalid league survival model shape');
  });

  it('propagates JSON parsing failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{invalid')));
    await expect(fetchLeagueSurvivalModel()).rejects.toThrow();
  });
});
