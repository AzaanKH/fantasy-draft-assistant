import { describe, expect, it } from 'vitest';
import {
  yahooDraftResultsFixture,
  yahooPlayersFixture,
  yahooSettingsFixture,
} from './__fixtures__/yahoo-fixtures.js';
import {
  parseYahooDraftResults,
  parseYahooLeagueId,
  YahooSyncAdapter,
  YAHOO_PUBLIC_API_BASE,
  YAHOO_PUBLIC_READ_API_BASE,
} from './yahoo-adapter.js';
import type { FetchJson } from './sync-adapter.js';

function createYahooFetch(
  log: string[],
  optionsLog: Array<RequestInit | undefined> = [],
  playersPayload: unknown = yahooPlayersFixture
): FetchJson {
  return async <T>(
    url: string,
    _signal: AbortSignal,
    init?: RequestInit
  ): Promise<T> => {
    log.push(url);
    optionsLog.push(init);
    if (
      url ===
      `${YAHOO_PUBLIC_API_BASE}/settings/nfl/7428778?format=rawjson`
    ) {
      return yahooSettingsFixture as T;
    }
    if (
      url ===
      `${YAHOO_PUBLIC_API_BASE}/players/nfl/7428778?images=0&projected=0&average=0&format=rawjson`
    ) {
      return playersPayload as T;
    }
    if (
      url.startsWith(
        `${YAHOO_PUBLIC_READ_API_BASE}/league/999.l.7428778/draftresults?`
      )
    ) {
      return yahooDraftResultsFixture as T;
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

describe('YahooSyncAdapter', () => {
  it('extracts a league ID from Yahoo league and draft room URLs', () => {
    expect(parseYahooLeagueId('7428778')).toBe('7428778');
    expect(
      parseYahooLeagueId(
        'https://football.fantasysports.yahoo.com/f1/7428778'
      )
    ).toBe('7428778');
    expect(
      parseYahooLeagueId(
        'https://football.fantasysports.yahoo.com/draftclient/f1/7428778/3'
      )
    ).toBe('7428778');
    expect(
      parseYahooLeagueId(
        'https://sports-fantasy.media.yahoo.com/draft/f1/7428778/3'
      )
    ).toBe('7428778');
    expect(parseYahooLeagueId('https://example.com/f1/7428778')).toBeNull();
  });

  it('discovers the season-specific league key and ignores unfilled slots', async () => {
    const requests: string[] = [];
    const adapter = new YahooSyncAdapter(
      '7428778',
      createYahooFetch(requests)
    );

    const snapshot = await adapter.poll(new AbortController().signal);

    expect(snapshot.draft.providerKey).toBe('999.l.7428778');
    expect(snapshot.draft.settings).toEqual({
      teams: 2,
      rounds: 2,
      pickTimer: 30,
    });
    expect(snapshot.picks).toHaveLength(2);
    expect(snapshot.picks[0]).toMatchObject({
      pickNumber: 1,
      playerId: '999.p.101',
      playerName: 'Alpha Quarterback',
      position: 'QB',
      nflTeam: 'BUF',
      draftSlot: 1,
      source: 'yahoo-public',
    });
    expect(snapshot.picks[1]).toMatchObject({
      pickNumber: 3,
      playerId: '999.p.103',
      draftSlot: 2,
      teamIndex: 1,
    });
    expect(requests.at(-1)).toContain('/league/999.l.7428778/draftresults');
    expect(requests.join('\n')).not.toContain('/league/7428778/draftresults');
  });

  it('normalizes a Yahoo draft room URL before constructing requests', async () => {
    const requests: string[] = [];
    const adapter = new YahooSyncAdapter(
      'https://football.fantasysports.yahoo.com/draftclient/f1/7428778/3',
      createYahooFetch(requests)
    );

    await adapter.poll(new AbortController().signal);

    expect(adapter.draftId).toBe('7428778');
    expect(requests[0]).toBe(
      `${YAHOO_PUBLIC_API_BASE}/settings/nfl/7428778?format=rawjson`
    );
  });

  it('loads Yahoo settings and players once while polling results repeatedly', async () => {
    const requests: string[] = [];
    const requestOptions: Array<RequestInit | undefined> = [];
    const adapter = new YahooSyncAdapter(
      '7428778',
      createYahooFetch(requests, requestOptions)
    );
    const signal = new AbortController().signal;

    await adapter.poll(signal);
    await adapter.poll(signal);

    expect(requests.filter((url) => url.includes('/settings/'))).toHaveLength(1);
    expect(requests.filter((url) => url.includes('/players/'))).toHaveLength(1);
    const draftResultUrls = requests.filter((url) =>
      url.includes('/draftresults')
    );
    expect(draftResultUrls).toHaveLength(2);
    expect(new Set(draftResultUrls).size).toBe(2);
    for (const url of draftResultUrls) {
      const parsedUrl = new URL(url);
      expect(parsedUrl.searchParams.get('format')).toBe('json');
      expect(parsedUrl.searchParams.get('_sync')).toMatch(/^\d+-\d+$/);
    }
    expect(requestOptions.at(-1)).toEqual({
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
  });

  it('preserves an unrecognized Yahoo position as null', async () => {
    const requests: string[] = [];
    const playersWithUnknownPosition = {
      service: {
        player_list: yahooPlayersFixture.service.player_list.map(
          (player, index) =>
            index === 0
              ? { ...player, display_pos: 'ATH' }
              : player
        ),
      },
    };
    const adapter = new YahooSyncAdapter(
      '7428778',
      createYahooFetch(requests, [], playersWithUnknownPosition)
    );

    const snapshot = await adapter.poll(new AbortController().signal);

    expect(snapshot.picks[0]).toMatchObject({
      playerId: '999.p.101',
      position: null,
    });
  });

  it('parses nested Yahoo draft-result collections', () => {
    expect(parseYahooDraftResults(yahooDraftResultsFixture)).toEqual([
      {
        round: 1,
        pickNumber: 1,
        teamKey: '999.l.7428778.t.1',
        playerKey: '999.p.101',
        isKeeper: false,
      },
      {
        round: 1,
        pickNumber: 2,
        teamKey: '999.l.7428778.t.2',
        playerKey: null,
        isKeeper: false,
      },
      {
        round: 2,
        pickNumber: 3,
        teamKey: '999.l.7428778.t.2',
        playerKey: '999.p.103',
        isKeeper: false,
      },
    ]);
  });
});
