import { fixtureFetchJson, type FixtureFetchJson } from './__fixtures__/fetch-json.js';
import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  FantasyFootballCalculatorAdpProvider,
  FFC_API_BASE,
} from './fantasy-football-calculator.js';


describe('FantasyFootballCalculatorAdpProvider', () => {
  it('normalizes and caches PPR ADP responses', async () => {
    let fetchCalls = 0;
    const fetchJson: FixtureFetchJson = async (url: string): Promise<unknown> => {
      fetchCalls += 1;
      expect(url).toBe(`${FFC_API_BASE}/ppr?teams=10&year=2026`);
      return {
        status: 'Success',
        meta: { total_drafts: 321 },
        players: [
          { player_id: 1, name: 'Test Runner', position: 'RB', team: 'DET', adp: 12.4 },
          { player_id: 2, name: 'Test Defense', position: 'DST', team: 'BUF', adp: '150.5' },
          { player_id: 3, name: 'Test Kicker', position: 'PK', team: 'KC', adp: 160 },
        ],
      };
    };
    const provider = new FantasyFootballCalculatorAdpProvider(fixtureFetchJson(fetchJson));

    const first = await Effect.runPromise(provider.getSnapshot('ppr', 10, 2026));
    const cached = await Effect.runPromise(provider.getSnapshot('ppr', 10, 2026));

    expect(first).toMatchObject({
      source: 'fantasy-football-calculator',
      format: 'ppr',
      teams: 10,
      season: 2026,
      draftCount: 321,
      players: [
        { externalId: '1', position: 'RB', team: 'DET', adp: 12.4 },
        { externalId: '2', position: 'DEF', team: 'BUF', adp: 150.5 },
        { externalId: '3', position: 'K', team: 'KC', adp: 160 },
      ],
    });
    expect(cached).toBe(first);
    expect(fetchCalls).toBe(1);
  });

  it('falls back to a name-position ID when the provider ID is malformed', async () => {
    const fetchJson: FixtureFetchJson = async (): Promise<unknown> => ({
      status: 'Success',
      meta: { total_drafts: 10 },
      players: [
        { player_id: { id: 7 }, name: 'Object Id', position: 'WR', team: 'MIA', adp: 20 },
        { player_id: ['8'], name: 'Array Id', position: 'TE', team: 'KC', adp: 30 },
        { player_id: null, name: 'Null Id', position: 'QB', team: 'BUF', adp: 40 },
        { name: 'Missing Id', position: 'RB', team: 'SF', adp: 50 },
        { player_id: 'abc-9', name: 'String Id', position: 'RB', team: 'DET', adp: 60 },
      ],
    });
    const provider = new FantasyFootballCalculatorAdpProvider(fixtureFetchJson(fetchJson));

    const snapshot = await Effect.runPromise(provider.getSnapshot('ppr', 12, 2026));

    expect(snapshot.players.map((player) => player.externalId)).toEqual([
      'Object Id-WR',
      'Array Id-TE',
      'Null Id-QB',
      'Missing Id-RB',
      'abc-9',
    ]);
    expect(snapshot.players.some((player) => player.externalId.includes('[object'))).toBe(false);
  });
});

describe('optional market row warnings', () => {
  it('reports rejected provider rows alongside retained market players', async () => {
    const fetchJson: FixtureFetchJson = async (): Promise<unknown> => ({ status: 'Success', players: [
      { player_id: 1, name: 'Valid', position: 'RB', team: 'DET', adp: 10 },
      { player_id: 2, name: 'Invalid', position: 'INVALID', adp: 20 }, null,
    ] });
    const snapshot = await Effect.runPromise(new FantasyFootballCalculatorAdpProvider(fixtureFetchJson(fetchJson)).getSnapshot('ppr', 10, 2026));
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot).toHaveProperty('warnings', ['Dropped 2 invalid Fantasy Football Calculator rows.']);
  });
});
