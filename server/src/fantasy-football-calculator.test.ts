import { describe, expect, it } from 'vitest';
import {
  FantasyFootballCalculatorAdpProvider,
  FFC_API_BASE,
} from './fantasy-football-calculator.js';
import type { FetchJson } from './sync-adapter.js';

describe('FantasyFootballCalculatorAdpProvider', () => {
  it('normalizes and caches PPR ADP responses', async () => {
    let fetchCalls = 0;
    const fetchJson: FetchJson = async <T>(url: string): Promise<T> => {
      fetchCalls += 1;
      expect(url).toBe(`${FFC_API_BASE}/ppr?teams=10&year=2026`);
      return {
        status: 'Success',
        meta: { total_drafts: 321 },
        players: [
          { player_id: 1, name: 'Test Runner', position: 'RB', team: 'DET', adp: 12.4 },
          { player_id: 2, name: 'Test Defense', position: 'DST', team: 'BUF', adp: '150.5' },
        ],
      } as T;
    };
    const provider = new FantasyFootballCalculatorAdpProvider(fetchJson);
    const signal = new AbortController().signal;

    const first = await provider.getSnapshot('ppr', 10, 2026, signal);
    const cached = await provider.getSnapshot('ppr', 10, 2026, signal);

    expect(first).toMatchObject({
      source: 'fantasy-football-calculator',
      format: 'ppr',
      teams: 10,
      season: 2026,
      draftCount: 321,
      players: [
        { externalId: '1', position: 'RB', team: 'DET', adp: 12.4 },
        { externalId: '2', position: 'DEF', team: 'BUF', adp: 150.5 },
      ],
    });
    expect(cached).toBe(first);
    expect(fetchCalls).toBe(1);
  });
});
