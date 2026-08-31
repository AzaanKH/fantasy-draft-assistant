import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  draftFixture,
  leagueFixture,
  picksFixture,
} from './__fixtures__/sleeper-fixtures.js';
import { createSyncServer, SLEEPER_API_BASE, type FetchJson } from './sync-server.js';
import type {
  DraftSyncSnapshot,
  EspnDraftSnapshot,
} from '@fantasy-draft/shared';
import {
  yahooDraftResultsFixture,
  yahooPlayersFixture,
  yahooSettingsFixture,
} from './__fixtures__/yahoo-fixtures.js';
import {
  YAHOO_PUBLIC_API_BASE,
  YAHOO_PUBLIC_READ_API_BASE,
} from './yahoo-adapter.js';

function createMockFetchJson(): FetchJson {
  return async <T>(url: string): Promise<T> => {
    if (url === `${SLEEPER_API_BASE}/draft/fixture-draft`) {
      return draftFixture as T;
    }

    if (url === `${SLEEPER_API_BASE}/draft/fixture-draft/picks`) {
      return picksFixture as T;
    }

    if (url === `${SLEEPER_API_BASE}/league/fixture-league`) {
      return leagueFixture as T;
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
}

function createYahooMockFetchJson(): FetchJson {
  return async <T>(url: string): Promise<T> => {
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
      return yahooPlayersFixture as T;
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

describe('createSyncServer', () => {
  it('returns a normalized draft snapshot from mocked Sleeper responses', async () => {
    const server = createSyncServer({
      fetchJson: createMockFetchJson(),
      pollIntervalMs: 60_000,
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/drafts/fixture-draft`, {
        headers: { Origin: 'http://localhost:3000' },
      });
      expect(response.ok).toBe(true);

      const snapshot = (await response.json()) as DraftSyncSnapshot;

      expect(snapshot.provider).toBe('sleeper');
      expect(snapshot.draft?.providerKey).toBe(draftFixture.draft_id);
      expect(snapshot.draft?.leagueSettings).toMatchObject({
        source: 'sleeper',
        leagueId: 'fixture-league',
        totalTeams: 10,
        scoringRules: {
          receiving: { reception: 1, tePremium: 0.5 },
          rushing: { attemptBonus: 0.2 },
        },
        rosterRequirements: {
          FLEX: { starters: 2 },
          BENCH: { spots: 6 },
        },
      });
      expect(snapshot.picks).toHaveLength(3);
      expect(snapshot.picks[0]?.playerName).toBe('Christian McCaffrey');
      expect(snapshot.picks[2]?.position).toBe('TE');
      expect(snapshot.status).toBe('synced');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('serves Yahoo through the same canonical snapshot and SSE route model', async () => {
    const server = createSyncServer({
      fetchJson: createYahooMockFetchJson(),
      pollIntervalMs: 60_000,
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/sync/yahoo/drafts/7428778`,
        { headers: { Origin: 'http://localhost:3000' } }
      );
      expect(response.ok).toBe(true);

      const snapshot = (await response.json()) as DraftSyncSnapshot;
      expect(snapshot.provider).toBe('yahoo');
      expect(snapshot.draft?.providerKey).toBe('999.l.7428778');
      expect(snapshot.picks).toHaveLength(2);
      expect(snapshot.picks[0]?.playerName).toBe('Alpha Quarterback');
      expect(snapshot.picks[1]?.pickNumber).toBe(3);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('accepts sanitized ESPN extension snapshots and reconciles undo state', async () => {
    const server = createSyncServer({ pollIntervalMs: 60_000 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
    const draft: EspnDraftSnapshot['draft'] = {
      provider: 'espn',
      draftId: '4242',
      providerKey: '2026:4242',
      status: 'drafting',
      type: 'snake',
      settings: { teams: 10, rounds: 16, pickTimer: 30 },
      draftOrder: null,
    };
    const pick: EspnDraftSnapshot['picks'][number] = {
      draftId: '4242',
      pickNumber: 1,
      round: 1,
      rosterId: 7,
      draftSlot: 7,
      teamIndex: 6,
      playerId: '4429795',
      playerName: 'Example Runner',
      position: 'RB',
      nflTeam: 'ATL',
      isKeeper: false,
      source: 'espn-extension',
      confidence: 'confirmed',
      observedAt: 1000,
    };

    const publish = (
      picks: EspnDraftSnapshot['picks'],
      observedAt: number = 1000
    ) =>
      fetch(`http://127.0.0.1:${port}/api/sync/espn/drafts/4242/snapshot`, {
        method: 'POST',
        headers: {
          Origin: extensionOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ draft, picks, observedAt }),
      });

    try {
      const published = await publish([pick]);
      expect(published.ok).toBe(true);
      expect(published.headers.get('access-control-allow-origin')).toBe(
        extensionOrigin
      );
      expect((await published.json()) as DraftSyncSnapshot).toMatchObject({
        provider: 'espn',
        status: 'synced',
        picks: [{ playerId: '4429795', pickNumber: 1 }],
      });

      const stale = await publish([], 999);
      expect(stale.ok).toBe(true);
      expect(((await stale.json()) as DraftSyncSnapshot).picks).toHaveLength(1);

      const undone = await publish([], 1001);
      expect(undone.ok).toBe(true);
      expect(((await undone.json()) as DraftSyncSnapshot).picks).toHaveLength(0);

      const read = await fetch(
        `http://127.0.0.1:${port}/api/sync/espn/drafts/4242`,
        { headers: { Origin: 'http://localhost:3000' } }
      );
      expect(read.ok).toBe(true);
      expect(((await read.json()) as DraftSyncSnapshot).picks).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it('serves health checks', async () => {
    const server = createSyncServer({
      fetchJson: createMockFetchJson(),
      pollIntervalMs: 60_000,
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(response.ok).toBe(true);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('serves private draft inputs through authorized API routes', async () => {
    const currentKeepers = {
      season: 2026,
      updatedAt: '2026-08-12T00:00:00.000Z',
      keepers: [{ playerName: 'Example Runner', position: 'RB', team: 5, round: 10 }],
    };
    const sportsbookSnapshot = {
      metadata: { season: 2026, capturedAt: '2026-08-12T00:00:00.000Z' },
      overUnder: [],
      milestones: [],
    };
    const server = createSyncServer({
      draftData: { currentKeepers, sportsbookSnapshot },
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const headers = { Origin: 'http://localhost:3000' };
      const keeperResponse = await fetch(
        `http://127.0.0.1:${port}/api/draft-data/current-keepers`,
        { headers }
      );
      const sportsbookResponse = await fetch(
        `http://127.0.0.1:${port}/api/draft-data/sportsbook`,
        { headers }
      );

      expect(keeperResponse.ok).toBe(true);
      expect(await keeperResponse.json()).toEqual(currentKeepers);
      expect(sportsbookResponse.ok).toBe(true);
      expect(await sportsbookResponse.json()).toEqual(sportsbookSnapshot);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it('rejects unauthorized draft requests before fetching Sleeper', async () => {
    let fetchCalls = 0;
    const server = createSyncServer({
      fetchJson: async <T>(): Promise<T> => {
        fetchCalls += 1;
        return draftFixture as T;
      },
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/drafts/fixture-draft`, {
        headers: { Origin: 'https://untrusted.example' },
      });

      expect(response.status).toBe(403);
      expect(fetchCalls).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('times out stalled Sleeper requests and clears the sync state', async () => {
    const server = createSyncServer({
      requestTimeoutMs: 5,
      fetchJson: <T>(_url: string, signal: AbortSignal) => new Promise<T>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Sleeper request timed out')));
      }),
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/drafts/fixture-draft`, {
        headers: { Origin: 'http://localhost:3000' },
      });
      const snapshot = (await response.json()) as DraftSyncSnapshot;

      expect(snapshot.status).toBe('error');
      expect(snapshot.lastError).toBe('Sleeper request timed out');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('records each 2026 shadow recommendation decision once', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'fantasy-shadow-log-'));
    const shadowLogPath = join(temporaryDirectory, 'recommendations.ndjson');
    const server = createSyncServer({
      fetchJson: createMockFetchJson(),
      shadowLogPath,
    });
    const event = {
      eventId: '2026:sleeper:fixture-draft:1',
      season: 2026,
      draftId: 'fixture-draft',
      pickNumber: 1,
      observedAt: '2026-08-20T18:00:00.000Z',
      experiment: {
        sourceLabel: 'Experimental prediction artifact',
        modelVersion: 'test-model',
        generatedAt: '2026-08-20T17:00:00.000Z',
        freshness: 'ready',
      },
      coreDecision: {
        ecrAnchor: 'FantasyPros ECR',
        policy: 'primary-league-policy',
        bestPick: { playerId: 'fallback-1', playerName: 'Fallback Player', position: 'RB', score: 100 },
        bestPlayer: { playerId: 'ecr-1', playerName: 'ECR Player', position: 'WR', score: -1 },
        recommendations: [
          { playerId: 'fallback-1', playerName: 'Fallback Player', position: 'RB', score: 100 },
        ],
      },
      shadowRecommendations: [
        { playerId: 'model-1', playerName: 'Model Player', position: 'WR', score: 101 },
      ],
      disagreement: true,
      context: {
        draftProvider: 'sleeper',
        leagueSettingsFingerprint: 'primary-league-test',
        totalTeams: 10,
        totalRounds: 15,
        myPickPosition: 1,
        draftedPlayerIds: [],
        rosterPlayerIds: [],
        positionNeeds: [{ position: 'RB', priority: 'critical' }],
      },
    };

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const post = () => fetch(`http://127.0.0.1:${port}/api/shadow-recommendations`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });
      const first = await post();
      const duplicate = await post();

      expect(first.status).toBe(201);
      expect(await first.json()).toEqual({ eventId: event.eventId, recorded: true });
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toEqual({ eventId: event.eventId, recorded: false });

      const lines = (await readFile(shadowLogPath, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        eventId: event.eventId,
        disagreement: true,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
