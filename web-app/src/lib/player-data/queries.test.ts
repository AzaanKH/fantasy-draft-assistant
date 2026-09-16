import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPlayerIdentityData, fetchPredictionData } from './queries';
import { isPlayerIdentityFile } from './validators';

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
    expect(isPlayerIdentityFile(data)).toBe(true);
  });

  it('keeps missing experimental predictions optional', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(fetchPredictionData()).resolves.toEqual({
      generatedAt: null, modelVersion: 'none', players: [],
    });
  });

  it('reports identity HTTP errors without attempting to merge data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(fetchPlayerIdentityData()).rejects.toThrow('Failed to load player identity data: 503');
  });
});
