import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchContractData, fetchMarketAdp, fetchSportsbookSnapshot, fetchPlayerIdentityData, fetchPredictionData, fetchSleeperData, fetchTeamEnvData } from './queries';
import { decodePlayerIdentityFile } from '@fantasy-draft/shared/catalog';

const identity = {
  canonicalId: 'sleeper:123',
  sleeperId: '123',
  fantasyProsId: '456',
  name: 'Fixture Player',
  aliases: ['Fixture Player'],
  position: 'WR',
  team: 'DAL',
};

function identityFile(players: unknown[]) {
  return {
    generatedAt: '2026-09-05T11:00:00.000Z',
    season: 2026,
    coverage: { fantasyProsRankingMatchRate: 1, matchedDefenses: 32 },
    players,
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('player data loading', () => {
  it.each([
    null,
    {},
    { ...identity, canonicalId: '' },
    { ...identity, name: null },
    { ...identity, aliases: [null] },
    { ...identity, aliases: 'Fixture Player' },
    { ...identity, position: 'INVALID' },
    { ...identity, team: 'INVALID' },
    { ...identity, sleeperId: 123 },
    { ...identity, fantasyProsId: '' },
  ])('rejects malformed identity rows before merging: %j', async (row) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(identityFile([identity, row])))
    ));
    await expect(fetchPlayerIdentityData()).rejects.toThrow('Invalid player identity data format');
  });

  it('loads identities with optional provider IDs omitted', async () => {
    const { sleeperId: _sleeperId, fantasyProsId: _fantasyProsId, ...withoutProviderIds } = identity;
    const data = identityFile([withoutProviderIds]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    await expect(fetchPlayerIdentityData()).resolves.toEqual(data);
  });

  it('accepts the generated identity artifact used by the app', () => {
    const data: unknown = JSON.parse(readFileSync(
      new URL('../../../../data/player-identity.json', import.meta.url), 'utf8'
    ));
    expect(decodePlayerIdentityFile(data)).toEqual(data);
  });

  it('keeps missing experimental predictions optional', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(fetchPredictionData()).resolves.toEqual({
      generatedAt: null, modelVersion: 'none', players: [], warnings: [],
    });
  });

  it('reports identity HTTP errors without attempting to merge data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(fetchPlayerIdentityData()).rejects.toThrow('Failed to load player identity data: 503');
  });
});

function mockJsonResponse(data: unknown): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => data,
  }));
}

const prediction = {
  name: 'Fixture Player', position: 'WR', team: 'DAL', projectedPoints: 200, source: 'model',
};
const optionalPredictionNumbers = [
  'baseProjectedPoints', 'usageEfficiencyAdjustment', 'customScoringAdjustment',
  'customProjectedPoints', 'floorProjectedPoints', 'ceilingProjectedPoints',
  'positionPercentile', 'valueOverReplacement', 'ceilingScore', 'floorScore',
  'uncertaintyScore', 'riskScore', 'injuryRiskScore',
];
const optionalPredictionStrings = ['playerId', 'modelFamily', 'modelVersion'];

function predictionsFile(player: unknown) {
  return { generatedAt: null, modelVersion: 'test', players: [player] };
}

describe('prediction response validation', () => {
  it.each(optionalPredictionNumbers)('drops a row with invalid optional numeric field %s', async (field) => {
    for (const value of ['200', null, true, {}, NaN, Infinity, -Infinity]) {
      mockJsonResponse(predictionsFile({ ...prediction, [field]: value }));
      const data = await fetchPredictionData();
      expect(data.players).toEqual([]);
      expect(data.warnings?.[0]).toContain('Dropped 1 invalid prediction');
    }
  });

  it.each(optionalPredictionStrings)('drops a row with invalid optional string field %s', async (field) => {
    for (const value of [123, null, true, {}]) {
      mockJsonResponse(predictionsFile({ ...prediction, [field]: value }));
      const data = await fetchPredictionData();
      expect(data.players).toEqual([]);
      expect(data.warnings?.[0]).toContain('Dropped 1 invalid prediction');
    }
  });

  it('keeps good prediction rows and warns about only the dropped rows', async () => {
    mockJsonResponse({ generatedAt: null, modelVersion: 'fixture',
      players: [prediction, { ...prediction, team: 'INVALID' }, prediction] });
    const data = await fetchPredictionData();
    expect(data.players).toEqual([prediction, prediction]);
    expect(data.warnings).toEqual(['Dropped 1 invalid prediction rows.']);
    expect(data.warnings).toHaveLength(1);
  });

  it('replaces untrusted warning metadata with warnings from this decode', async () => {
    mockJsonResponse({ generatedAt: null, modelVersion: 'fixture', players: [prediction], warnings: 123 });
    expect((await fetchPredictionData()).warnings).toEqual([]);
  });

  it('rejects malformed prediction envelopes', async () => {
    for (const data of [null, {}, { generatedAt: null, modelVersion: '', players: [] },
      { generatedAt: null, modelVersion: 'fixture', players: {} }]) {
      mockJsonResponse(data);
      await expect(fetchPredictionData()).rejects.toThrow('Invalid prediction data format');
    }
  });

  it('accepts omitted optional fields and correctly typed optional values, including zero', async () => {
    for (const player of [prediction, {
      ...prediction,
      ...Object.fromEntries(optionalPredictionNumbers.map((key) => [key, 0])),
      ...Object.fromEntries(optionalPredictionStrings.map((key) => [key, 'test'])),
    }]) {
      const data = predictionsFile(player);
      mockJsonResponse(data);
      await expect(fetchPredictionData()).resolves.toEqual({ ...data, warnings: [] });
    }
  });
});

const sleeperPlayer = {
  playerId: '123', name: 'Fixture Player', position: 'WR', team: 'DAL',
  sleeperAdp: 10, age: null, yearsExp: null, status: 'Active',
};
const sleeperFile = {
  fetchedAt: '2026-09-05T11:00:00.000Z', source: 'sleeper', playerCount: 1,
  players: [sleeperPlayer],
};
const teamEnvironmentFile = JSON.parse(readFileSync(
  new URL('../../../../data/team-environment.json', import.meta.url), 'utf8'
)) as Record<string, unknown>;

// A complete record is required by TeamEnvDataFile, so mutate one generated team at a time.
function withTeamEnvironment(value: unknown) {
  return { ...teamEnvironmentFile, teams: { ...teamEnvironmentFile['teams'] as object, DAL: value } };
}
const teamEnvironment = {
  team: 'DAL', name: 'Dallas Cowboys', offenseScore: 5,
  passVolume: 'medium', rushVolume: 'medium', pointsRank: 16,
  passAttemptsRank: 16, rushAttemptsRank: 16, coachingStability: true,
};

describe('Sleeper and team environment response validation', () => {
  it.each([
    null, {}, { ...sleeperFile, fetchedAt: null }, { ...sleeperFile, source: 1 },
    { ...sleeperFile, playerCount: Infinity }, { ...sleeperFile, playerCount: 2 },
    { ...sleeperFile, players: {} },
  ])('rejects malformed Sleeper data: %j', async (data) => {
    mockJsonResponse(data);
    await expect(fetchSleeperData()).rejects.toThrow('Invalid Sleeper data format');
  });

  it('accepts nullable player metadata and defense rows without player metadata', async () => {
    const defense = { playerId: 'DAL', name: 'DAL Defense', position: 'DEF', team: 'DAL', sleeperAdp: 999 };
    const data = { ...sleeperFile, playerCount: 2, players: [sleeperPlayer, defense] };
    mockJsonResponse(data);
    await expect(fetchSleeperData()).resolves.toEqual({ ...data, warnings: [] });
  });

  it.each([
    null, {}, { ...teamEnvironmentFile, generatedAt: null },
    { ...teamEnvironmentFile, season: '2026' }, { ...teamEnvironmentFile, teamCount: NaN },
    { ...teamEnvironmentFile, teamCount: 31 },
    { ...teamEnvironmentFile, teams: [] }, { ...teamEnvironmentFile, teams: {} },
  ])('rejects malformed team environment data: %j', async (data) => {
    mockJsonResponse(data);
    await expect(fetchTeamEnvData()).rejects.toThrow('Invalid team environment data format');
  });

  it.each([
    ['sleeper-adp', fetchSleeperData],
    ['team-environment', fetchTeamEnvData],
    ['predictions', fetchPredictionData],
  ] as const)('accepts the generated %s artifact used by the app', async (file, fetchData) => {
    const data: unknown = JSON.parse(readFileSync(
      new URL(`../../../../data/${file}.json`, import.meta.url), 'utf8'
    ));
    mockJsonResponse(data);
    const loaded = await fetchData();
    if ('warnings' in loaded) {
      const { warnings, ...payload } = loaded;
      expect(warnings).toEqual([]);
      expect(payload).toEqual(data);
    } else expect(loaded).toEqual(data);
  });
});


describe('optional boundary row recovery', () => {
  it('keeps usable Sleeper rows and reports discarded rows', async () => {
    mockJsonResponse({ ...sleeperFile, playerCount: 2, players: [sleeperPlayer, null] });
    await expect(fetchSleeperData()).resolves.toMatchObject({
      players: [sleeperPlayer], playerCount: 1, warnings: ['Dropped 1 invalid Sleeper rows.'],
    });
  });

  it('keeps other team environments when one team is malformed', async () => {
    mockJsonResponse(withTeamEnvironment({ ...teamEnvironment, offenseScore: Infinity }));
    const data = await fetchTeamEnvData();
    expect(data.teams.DAL).toBeUndefined();
    expect(Object.keys(data.teams)).toHaveLength(31);
    expect(data).toHaveProperty('warnings', ['Dropped 1 invalid team environment rows.']);
  });

  it('keeps usable contracts and reports discarded rows', async () => {
    const player = { name: 'Fixture', position: 'WR', team: 'DAL', contractEndYear: 2026, isContractYear: true };
    mockJsonResponse({ contractYear: 2026, playerCount: 2, players: [player, { ...player, contractEndYear: null }] });
    await expect(fetchContractData()).resolves.toMatchObject({
      players: [player], playerCount: 1, warnings: ['Dropped 1 invalid contract rows.'],
    });
  });

  it('keeps usable market ADP rows and reports discarded rows', async () => {
    const player = { externalId: '1', name: 'Fixture', position: 'WR', team: 'DAL', adp: 10 };
    mockJsonResponse({ source: 'fantasy-football-calculator', format: 'ppr', teams: 10, season: 2026,
      refreshedAt: '2026-09-05', draftCount: null, players: [player, { ...player, adp: 0 }] });
    await expect(fetchMarketAdp('ppr', 10, 2026)).resolves.toMatchObject({
      players: [player], warnings: ['Dropped 1 invalid market ADP rows.'],
    });
  });

  it('keeps usable sportsbook lines and exposes recovery warnings', async () => {
    const line = { sportsbook: 'draftkings', playerName: 'Fixture', market: 'receivingYards', line: 900,
      overOdds: -110, underOdds: -110, sourceFile: 'fixture.csv' };
    mockJsonResponse({ metadata: { season: 2026, capturedAt: '2026-09-05', importedAt: '2026-09-05',
      sourceDirectory: 'fixture', overUnderCount: 2, milestoneCount: 0 }, overUnder: [line, null], milestones: [], warnings: [] });
    await expect(fetchSportsbookSnapshot()).resolves.toMatchObject({
      overUnder: [line], metadata: { overUnderCount: 1 }, warnings: ['Dropped 1 invalid sportsbook over/under rows.'],
    });
  });
});
