import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), readFile: vi.fn(),
}));
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); });

// The season boundary table lives in shared/src/units/clock.test.ts; these rows prove the
// Sleeper timestamp is read (2026 differs from the clock's 2025) and the clock fallback.
it.each([
  ['2026-03-01T00:00:00.000Z', 2026],
  ['invalid', 2025],
  ['', 2025],
])('reads the prediction NFL season from Sleeper timestamp %s', async (timestamp, season) => {
  vi.stubEnv('MODEL_SOURCE_PROFILE', 'fantasypros-free');
  vi.useFakeTimers({ now: Date.parse('2026-02-28T23:59:59.999Z'), toFake: ['Date'] });
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ fetchedAt: timestamp, source: 'fixture', playerCount: 0, players: [] }));
  const { readCurrentSeason } = await import('./build-prediction-dataset.js');
  expect(await Effect.runPromise(readCurrentSeason())).toBe(season);
});

it('preserves the explicit prediction snapshot season instead of inferring it from the clock', async () => {
  vi.stubEnv('MODEL_SOURCE_PROFILE', 'standard');
  vi.useFakeTimers({ now: Date.parse('2027-02-28T23:59:59.999Z'), toFake: ['Date'] });
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ metadata: { season: 2024, sourceType: 'api', source: 'fixture',
    refreshedAt: '2024-09-01', rankingCount: 0, adpCount: 0, projectionCount: 0, newsCount: 0 },
    rankings: [], adp: [], projections: [], news: [] }));
  const { readCurrentSeason } = await import('./build-prediction-dataset.js');
  expect(await Effect.runPromise(readCurrentSeason())).toBe(2024);
});
