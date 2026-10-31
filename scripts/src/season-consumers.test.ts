import { readFile, writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpRequestError, runMain } from './effect-runtime.js';
import { fetchFantasyProsSnapshot } from './fantasypros-api.js';

const fixture = vi.hoisted(() => ({ sql: [] as string[], rows: [] as Record<string, unknown>[] }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) }));
vi.mock('dotenv', () => ({ config: vi.fn() }));
vi.mock('./effect-runtime.js', async importOriginal => ({
  ...await importOriginal<typeof import('./effect-runtime.js')>(), runMain: vi.fn(), isEntryPoint: () => true,
}));
vi.mock('./fantasypros-api.js', () => ({ fetchFantasyProsSnapshot: vi.fn() }));
vi.mock('./model/duckdb.js', async importOriginal => ({
  ...await importOriginal<typeof import('./model/duckdb.js')>(),
  withMemoryDb: (use: (connection: unknown) => Effect.Effect<unknown, unknown>) => Effect.suspend(() => use({
    runAndReadAll: async (sql: string) => {
      fixture.sql.push(sql);
      if (sql.includes('stats_team_reg')) throw new Error('team query captured');
      return { getRowObjects: () => sql.includes('describe') ? [{ column_name: 'season_history' }] : fixture.rows };
    },
  })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.mocked(runMain).mockClear();
  vi.mocked(writeFile).mockClear();
  vi.mocked(readFile).mockReset();
  vi.mocked(fetchFantasyProsSnapshot).mockReset();
  fixture.sql = []; fixture.rows = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); });

async function runCaptured(): Promise<void> {
  const program = vi.mocked(runMain).mock.calls[0]?.[0];
  if (!program) throw new Error('Missing script program');
  await Effect.runPromise(program);
}

const boundaries = [
  ['2027-02-28T23:59:59.999Z', 2026],
  ['2027-03-01T00:00:00.000Z', 2027],
  ['2026-12-31T16:00:00.000-08:00', 2026],
] as const;

it.each(boundaries)('requests FantasyPros API data for the NFL season at %s', async (timestamp, season) => {
  vi.useFakeTimers({ now: Date.parse(timestamp), toFake: ['Date'] });
  vi.stubEnv('FANTASYPROS_API_KEY', 'fixture-only');
  vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  vi.mocked(fetchFantasyProsSnapshot).mockImplementation(options => Effect.succeed({
    metadata: { season: options.season, rankingCount: 0, adpCount: 0, projectionCount: 0, newsCount: 0,
      source: 'fixture', sourceType: 'api', refreshedAt: timestamp }, rankings: [], adp: [], projections: [], news: [],
  }));
  await import('./refresh-fantasypros-snapshot.js');
  await runCaptured();
  expect(fetchFantasyProsSnapshot).toHaveBeenCalledWith(expect.objectContaining({ season }));
});

it('fails the FantasyPros refresh without writing when the API request fails', async () => {
  vi.stubEnv('FANTASYPROS_API_KEY', 'fixture-only');
  vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  vi.mocked(fetchFantasyProsSnapshot).mockReturnValue(Effect.fail(new HttpRequestError({ message: 'FantasyPros unavailable', url: 'https://fixture.invalid' })));
  await import('./refresh-fantasypros-snapshot.js');
  await expect(runCaptured()).rejects.toThrow('FantasyPros unavailable');
  expect(writeFile).not.toHaveBeenCalled();
});

it('fails the FantasyPros refresh when no API key is set', async () => {
  vi.stubEnv('FANTASYPROS_API_KEY', '');
  await import('./refresh-fantasypros-snapshot.js');
  await expect(runCaptured()).rejects.toThrow('FANTASYPROS_API_KEY is not set');
  expect(fetchFantasyProsSnapshot).not.toHaveBeenCalled();
});

it.each(boundaries)('selects contract context for the NFL season at %s', async (timestamp, season) => {
  vi.useFakeTimers({ now: Date.parse(timestamp), toFake: ['Date'] });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ updated_at: timestamp })));
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ fetchedAt: timestamp, source: 'fixture', playerCount: 0, players: [] }));
  await import('./refresh-contracts.js');
  await runCaptured();
  expect(fixture.sql[1]).toContain(`contracts.contract_end_year = ${season}`);
  const output = vi.mocked(writeFile).mock.calls[0]?.[1];
  if (typeof output !== 'string') throw new Error('Missing contracts');
  expect(JSON.parse(output)).toMatchObject({ contractYear: season });
});

it.each(boundaries)('selects the season before the current NFL season for team environment at %s', async (timestamp, season) => {
  vi.useFakeTimers({ now: Date.parse(timestamp), toFake: ['Date'] });
  await import('./generate-team-env.js');
  await expect(runCaptured()).rejects.toThrow('team query captured');
  expect(fixture.sql[0]).toContain(`stats_team_reg_${season - 1}.parquet`);
  expect(fixture.sql[0]).toContain(`where season = ${season - 1}`);
});
