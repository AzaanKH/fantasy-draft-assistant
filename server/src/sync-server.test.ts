import { fixtureFetchJson, type FixtureFetchJson } from './__fixtures__/fetch-json.js';
import { decodeDraftSyncSnapshot, decodeDraftSyncUpdate } from '@fantasy-draft/shared/catalog';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import type { ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  draftFixture,
  leagueFixture,
  picksFixture,
} from './__fixtures__/sleeper-fixtures.js';
import { createSyncServer as createServer, SLEEPER_API_BASE, syncServerInternals } from './sync-server.js';
import type {
  DraftSyncUpdate,
  EspnDraftSnapshot,
} from '@fantasy-draft/shared/sync';
import {
  yahooDraftResultsFixture,
  yahooPlayersFixture,
  yahooSettingsFixture,
} from './__fixtures__/yahoo-fixtures.js';
import { SleeperSyncAdapter } from './sleeper-adapter.js';
import {
  YAHOO_PUBLIC_API_BASE,
  YAHOO_PUBLIC_READ_API_BASE,
} from './yahoo-adapter.js';

const TOKEN = 'test-only-capability-0000000000000000000000000';
function createSyncServer(options: Omit<NonNullable<Parameters<typeof createServer>[0]>, 'fetchJson'> & { fetchJson?: FixtureFetchJson } = {}) {
  return createServer({ ...options, requestToken: TOKEN,
    fetchJson: options.fetchJson ? fixtureFetchJson(options.fetchJson) : undefined,
  });
}

type SyncServer = ReturnType<typeof createSyncServer>;
const running = new Set<SyncServer>();

async function listen(server: SyncServer): Promise<string> {
  running.add(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

function shutdown(server: SyncServer): Promise<void> {
  running.delete(server);
  return new Promise((resolve, reject) => { server.shutdown(error => { if (error) reject(error); else resolve(); }); });
}

afterEach(async () => { await Promise.all([...running].map(shutdown)); });

function createMockFetchJson(): FixtureFetchJson {
  return async (url: string): Promise<unknown> => {
    if (url === `${SLEEPER_API_BASE}/draft/fixture-draft`) {
      return draftFixture;
    }

    if (url === `${SLEEPER_API_BASE}/draft/fixture-draft/picks`) {
      return picksFixture;
    }

    if (url === `${SLEEPER_API_BASE}/league/fixture-league`) {
      return leagueFixture;
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
}

function createYahooMockFetchJson(): FixtureFetchJson {
  return async (url: string): Promise<unknown> => {
    if (
      url ===
      `${YAHOO_PUBLIC_API_BASE}/settings/nfl/7428778?format=rawjson`
    ) {
      return yahooSettingsFixture;
    }
    if (
      url ===
      `${YAHOO_PUBLIC_API_BASE}/players/nfl/7428778?images=0&projected=0&average=0&format=rawjson`
    ) {
      return yahooPlayersFixture;
    }
    if (
      url.startsWith(
        `${YAHOO_PUBLIC_READ_API_BASE}/league/999.l.7428778/draftresults?`
      )
    ) {
      return yahooDraftResultsFixture;
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

describe('createSyncServer', () => {
  it('lists authenticated retained sessions without fetching providers or extending activity', async () => {
    const fixtureFetch = createMockFetchJson();
    let fetchCalls = 0;
    const server = createSyncServer({ fetchJson: async (url: string, signal: AbortSignal): Promise<unknown> => {
      fetchCalls += 1;
      return fixtureFetch(url, signal);
    } });
    const base = await listen(server);
    const headers = { 'X-Sync-Token': TOKEN };
    expect((await fetch(`${base}/api/sync/sessions`)).status).toBe(403);
    expect(await (await fetch(`${base}/api/sync/sessions`, { headers })).json()).toEqual({ sessions: [] });
    expect((await fetch(`${base}/api/sync/drafts/fixture-draft`, { headers })).ok).toBe(true);
    expect((await fetch(`${base}/api/sync/espn/drafts/42/refresh`, { method: 'POST', headers })).ok).toBe(true);
    const listing = await (await fetch(`${base}/api/sync/sessions`, { headers })).json();
    expect(listing).toMatchObject({ sessions: [
      { session: 'espn:42', provider: 'espn', draftId: '42', draftStatus: null,
        currentPick: null, picksRecorded: 0, sync: { state: 'idle' }, subscribers: 0 },
      { session: 'sleeper:fixture-draft', provider: 'sleeper', draftId: 'fixture-draft',
        draftStatus: 'drafting', draftType: 'snake', totalTeams: 10, totalRounds: 15,
        currentPick: 4, picksRecorded: 3, sync: { state: 'synced', lastError: null }, subscribers: 0 },
    ] });
    expect(fetchCalls).toBe(3);
    expect(await (await fetch(`${base}/api/sync/sessions`, { headers })).json()).toEqual(listing);
    expect(fetchCalls).toBe(3);
  });

  it('omits expired idle sessions from discovery', async () => {
    let fetchCalls = 0;
    const fixtureFetch = createMockFetchJson();
    const server = createSyncServer({ sessionStaleAfterMs: 1,
      fetchJson: async (url: string, signal: AbortSignal): Promise<unknown> => {
        fetchCalls += 1;
        return fixtureFetch(url, signal);
      } });
    const base = await listen(server);
    const headers = { 'X-Sync-Token': TOKEN };
    expect((await fetch(`${base}/api/sync/drafts/fixture-draft`, { headers })).ok).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await (await fetch(`${base}/api/sync/sessions`, { headers })).json()).toEqual({ sessions: [] });
    expect(fetchCalls).toBe(3);
  });

  it('rejects malformed draft IDs and continues serving valid draft requests', async () => {
    const server = createSyncServer({ fetchJson: createMockFetchJson() });
    const base = await listen(server);
    const headers = { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN };

    for (const path of [
      '/api/sync/sleeper/drafts/%ZZ',
      '/api/sync/yahoo/drafts/%E0%A4%A/events',
      '/api/sync/espn/drafts/%/snapshot',
      '/api/sync/drafts/%FF',
    ]) {
      const response = await fetch(`${base}${path}`, { headers });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid draft ID' });
    }
    const response = await fetch(`${base}/api/sync/drafts/fixture-draft`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider: 'sleeper', status: 'synced' });
  });

  it('revalidates league settings on explicit refresh even within the cache TTL', async () => {
    let settingsRequests = 0;
    const fixtureFetch = createMockFetchJson();
    const server = createSyncServer({ fetchJson: async (url: string, signal: AbortSignal): Promise<unknown> => {
      if (url.includes('/league/')) settingsRequests += 1;
      return fixtureFetch(url, signal);
    } });
    const base = await listen(server);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${base}/api/sync/drafts/fixture-draft/refresh`, {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN },
      });
      expect(await response.json()).toMatchObject({ status: 'synced' });
    }
    expect(settingsRequests).toBe(2);
  });

  it.each([
    ['sleeper', 'name'], ['sleeper', 'id'], ['yahoo', 'name'], ['yahoo', 'id'],
  ] as const)('rejects oversized normalized %s player %s before publication', async (provider, field) => {
    let invalid = provider === 'yahoo' && field === 'name';
    const fixtureFetch = provider === 'sleeper' ? createMockFetchJson() : createYahooMockFetchJson();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = createSyncServer({ pollIntervalMs: 60_000, fetchJson: async (url, signal, init) => {
      if (invalid && provider === 'sleeper' && url.endsWith('/picks')) {
        return picksFixture.map((pick, index) => index ? pick : {
          ...pick, ...(field === 'id' ? { player_id: 'x'.repeat(129) } : {}),
          metadata: pick.metadata && { ...pick.metadata, ...(field === 'name' ? { first_name: 'x'.repeat(257) } : {}) },
        });
      }
      if (invalid && provider === 'yahoo' && url.includes('/players/')) {
        return { service: { player_list: yahooPlayersFixture.service.player_list.map((player, index) => index ? player : {
          ...player, ...(field === 'name' ? { fname: 'x'.repeat(257) } : { player_key: 'x'.repeat(129) }),
        }) } };
      }
      if (invalid && provider === 'yahoo' && field === 'id' && url.includes('/draftresults')) {
        return { draft_result: { pick: '1', round: '1', team_key: '999.l.7428778.t.1', player_key: 'x'.repeat(129) } };
      }
      return fixtureFetch(url, signal, init);
    } });
    const path = provider === 'sleeper' ? 'drafts/fixture-draft' : 'yahoo/drafts/7428778';
    const url = `${await listen(server)}/api/sync/${path}`;
    const headers = { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN };
    try {
      const accepted = decodeDraftSyncSnapshot(await (await fetch(url, { headers })).json());
      if (invalid) {
        expect(accepted.status).toBe('error');
        expect(accepted.picks).toEqual([]);
        expect(warning).toHaveBeenCalledWith('[sync-server] Provider sync rejected', expect.any(String));
        return;
      }
      expect(accepted.status).toBe('synced');
      invalid = true;
      const rejected = decodeDraftSyncSnapshot(await (await fetch(`${url}/refresh`, { method: 'POST', headers })).json());
      expect(rejected.status).toBe('error');
      expect(rejected.picks).toEqual(accepted.picks);
      expect(rejected.lastSuccessfulSyncAt).toBe(accepted.lastSuccessfulSyncAt);
      expect(warning).toHaveBeenCalledWith('[sync-server] Provider sync rejected', expect.any(String));
    } finally {
      warning.mockRestore();
    }
  });

  it('returns a normalized draft snapshot from mocked Sleeper responses', async () => {
    const server = createSyncServer({
      fetchJson: createMockFetchJson(),
      pollIntervalMs: 60_000,
    });

    const base = await listen(server);

    const response = await fetch(`${base}/api/sync/drafts/fixture-draft`, {
      headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN },
    });
    expect(response.ok).toBe(true);

    const snapshot = decodeDraftSyncSnapshot(await response.json());

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
  });

  it('sends a small heartbeat for unchanged polls and a snapshot for a corrected pick', async () => {
    let providerPicks = picksFixture;
    const fixtureFetch = createMockFetchJson();
    const server = createSyncServer({
      pollIntervalMs: 1_000,
      fetchJson: async (url: string, signal: AbortSignal): Promise<unknown> =>
        url.endsWith('/fixture-draft/picks')
          ? providerPicks
          : fixtureFetch(url, signal),
    });
    const base = await listen(server);
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, 5_000);

    try {
      const response = await fetch(
        `${base}/api/sync/sleeper/drafts/fixture-draft/events`,
        {
          headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN },
          signal: controller.signal,
        }
      );
      expect(response.ok).toBe(true);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      const nextUpdate = async (): Promise<DraftSyncUpdate> => {
        for (;;) {
          const end = pending.indexOf('\n\n');
          if (end >= 0) {
            const event = pending.slice(0, end);
            pending = pending.slice(end + 2);
            const data = event.split('\n').find((line) => line.startsWith('data: '));
            if (data) return decodeDraftSyncUpdate(JSON.parse(data.slice(6)));
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error('Draft event stream closed');
          pending += decoder.decode(chunk.value, { stream: true });
        }
      };
      const until = async (matches: (update: DraftSyncUpdate) => boolean) => {
        for (;;) {
          const update = await nextUpdate();
          if (matches(update)) return update;
        }
      };

      const initial = await until((update) =>
        update.type === 'snapshot' && update.snapshot.status === 'synced'
      );
      expect(initial.type).toBe('snapshot');
      const heartbeat = await until((update) => update.type === 'heartbeat');
      expect(heartbeat).toMatchObject({
        type: 'heartbeat', provider: 'sleeper', draftId: 'fixture-draft',
      });
      expect(heartbeat).not.toHaveProperty('snapshot');

      providerPicks = picksFixture.map((pick, index) =>
        index === 0 ? { ...pick, player_id: 'corrected-player' } : pick
      );
      const correction = await until((update) =>
        update.type === 'snapshot' &&
        update.snapshot.picks[0]?.playerId === 'corrected-player'
      );
      expect(correction.type).toBe('snapshot');
      if (correction.type === 'snapshot') {
        expect(correction.snapshot.picks).toHaveLength(picksFixture.length);
      }
      await reader.cancel();
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });

  it('serves Yahoo through the same canonical snapshot and SSE route model', async () => {
    const server = createSyncServer({
      fetchJson: createYahooMockFetchJson(),
      pollIntervalMs: 60_000,
    });

    const base = await listen(server);

    const response = await fetch(
      `${base}/api/sync/yahoo/drafts/7428778`,
      { headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN } }
    );
    expect(response.ok).toBe(true);

    const snapshot = decodeDraftSyncSnapshot(await response.json());
    expect(snapshot.provider).toBe('yahoo');
    expect(snapshot.draft?.providerKey).toBe('999.l.7428778');
    expect(snapshot.picks).toHaveLength(2);
    expect(snapshot.picks[0]?.playerName).toBe('Alpha Quarterback');
    expect(snapshot.picks[1]?.pickNumber).toBe(3);
  });

  it('resends the full first snapshot on ESPN reconnect, including unchanged and disconnected undo state', async () => {
    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
    const server = createSyncServer({
      pollIntervalMs: 60_000,
      allowedOrigins: [extensionOrigin, 'http://localhost:3000'],
    });
    const base = await listen(server);
    const now = Date.now();
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
      observedAt: number = now
    ) =>
      fetch(`${base}/api/sync/espn/drafts/4242/snapshot`, {
        method: 'POST',
        headers: {
          Origin: extensionOrigin,
          'X-Sync-Token': TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ draft, picks, observedAt }),
      });

    const controllers: AbortController[] = [];
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    const timeout = setTimeout(() => { for (const controller of controllers) controller.abort(); }, 5_000);
    const expectFirstSnapshot = async (expected: ReturnType<typeof decodeDraftSyncSnapshot>) => {
      const controller = new AbortController();
      controllers.push(controller);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetch(`${base}/api/sync/espn/drafts/4242/events`, {
          headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN }, signal: controller.signal,
        });
        expect(response.ok).toBe(true);
        if (!response.body) throw new Error('Missing event stream');
        reader = response.body.getReader();
        readers.push(reader);
        const decoder = new TextDecoder();
        let buffer = '';
        while (!buffer.includes('\n\n')) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('Event stream closed before its first frame');
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        const firstFrame = buffer.slice(0, buffer.indexOf('\n\n'));
        expect(firstFrame).not.toContain('id:');
        const data = firstFrame.split('\n').find(line => line.startsWith('data: '));
        if (!data) throw new Error('First frame has no snapshot data');
        expect(decodeDraftSyncUpdate(JSON.parse(data.slice(6)))).toEqual({ type: 'snapshot', snapshot: expected });
      } finally {
        await reader?.cancel().catch(() => undefined);
        controller.abort();
      }
    };

    try {
      const published = await publish([pick]);
      expect(published.ok).toBe(true);
      expect(published.headers.get('access-control-allow-origin')).toBe(
        extensionOrigin
      );
      const expected = decodeDraftSyncSnapshot(await published.json());
      expect(expected).toMatchObject({
        provider: 'espn',
        status: 'synced',
        picks: [{ playerId: '4429795', pickNumber: 1 }],
      });

      await expectFirstSnapshot(expected);
      await expectFirstSnapshot(expected);

      const stale = await publish([], now - 1);
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({ error: 'Stale ESPN snapshot' });

      for (const skewed of [now - 5 * 60_000 - 1_000, now + 5 * 60_000 + 1_000]) {
        const rejected = await publish([], skewed);
        expect(rejected.status).toBe(400);
        expect(await rejected.json()).toEqual({ error: 'ESPN observation time must be within five minutes of the server clock' });
      }

      const undone = await publish([], now + 1);
      expect(undone.ok).toBe(true);
      const undoSnapshot = decodeDraftSyncSnapshot(await undone.json());
      expect(undoSnapshot.picks).toHaveLength(0);
      await expectFirstSnapshot(undoSnapshot);

      const read = await fetch(
        `${base}/api/sync/espn/drafts/4242`,
        { headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN } }
      );
      expect(read.ok).toBe(true);
      expect(decodeDraftSyncSnapshot(await read.json()).picks).toHaveLength(0);
    } finally {
      clearTimeout(timeout);
      for (const controller of controllers) controller.abort();
      await Promise.all(readers.map(reader => reader.cancel().catch(() => undefined)));
    }
  });

  it('serves health checks', async () => {
    const server = createSyncServer({
      fetchJson: createMockFetchJson(),
      pollIntervalMs: 60_000,
    });

    const base = await listen(server);

    const response = await fetch(`${base}/api/health`);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('starts the Core Draft Data refresh only for authorized requests and reports its progress', async () => {
    const scripts: string[] = [];
    const server = createSyncServer({
      runRefreshScript: (script) => {
        scripts.push(script);
        return Effect.void;
      },
    });
    const base = await listen(server);
    const url = `${base}/api/draft-data/refresh`;

    const unauthorized = await fetch(url, { method: 'POST', headers: { Origin: 'http://localhost:3000' } });
    expect(unauthorized.status).toBe(403);
    expect(scripts).toEqual([]);

    const headers = { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN };
    expect(await (await fetch(url, { headers })).json()).toMatchObject({ state: 'idle' });
    const started = await fetch(url, { method: 'POST', headers });
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ state: 'running' });

    await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(await (await fetch(url, { headers })).json()).toMatchObject({ state: 'succeeded' });
    expect(scripts).toEqual(['refresh:sleeper', 'refresh:fantasypros', 'data:identity']);
  });

  it('interrupts a running poll and refresh on shutdown', async () => {
    const fixtureFetch = createMockFetchJson();
    let pollStarted = false;
    let pollAborted = false;
    let refreshStarted = false;
    let refreshStopped = false;
    const server = createSyncServer({
      fetchJson: (url, signal) => {
        if (!url.endsWith('/fixture-draft/picks')) return fixtureFetch(url, signal);
        pollStarted = true;
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => { pollAborted = true; reject(new Error('aborted')); });
        });
      },
      runRefreshScript: () => Effect.callback(() => {
        refreshStarted = true;
        return Effect.sync(() => { refreshStopped = true; });
      }),
    });
    const base = await listen(server);
    const headers = { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN };

    const stream = await fetch(`${base}/api/sync/sleeper/drafts/fixture-draft/events`, { headers });
    expect(stream.ok).toBe(true);
    expect((await fetch(`${base}/api/draft-data/refresh`, { method: 'POST', headers })).status).toBe(202);
    await vi.waitFor(() => { expect(pollStarted && refreshStarted).toBe(true); });

    await shutdown(server);
    expect({ pollAborted, refreshStopped }).toEqual({ pollAborted: true, refreshStopped: true });
    await stream.body?.cancel();
  });

  it('shuts down without an unhandled rejection after a client abandons a provider request', async () => {
    let requestStarted = false;
    const server = createSyncServer({
      fetchJson: () => { requestStarted = true; return new Promise(() => {}); },
    });
    const base = await listen(server);
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => { rejections.push(reason); };
    process.on('unhandledRejection', onRejection);
    try {
      const client = new AbortController();
      const pending = fetch(`${base}/api/market-adp`, {
        headers: { 'X-Sync-Token': TOKEN }, signal: client.signal,
      }).catch(() => undefined);
      await vi.waitFor(() => { expect(requestStarted).toBe(true); });
      client.abort();
      await pending;
      await shutdown(server);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it.each(['current-keepers', 'sportsbook'])('rejects malformed %s files at the data endpoint', async (name) => {
    const server = createSyncServer({ draftData: { currentKeepers: {}, sportsbookSnapshot: {} } });
    const base = await listen(server);
    const response = await fetch(`${base}/api/draft-data/${name}`, {
      headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN },
    });
    expect(response.status).toBe(503);
  });

  it('serves private draft inputs through authorized API routes', async () => {
    const currentKeepers = {
      season: 2026,
      updatedAt: '2026-08-12T00:00:00.000Z',
      keepers: [{ playerName: 'Example Runner', position: 'RB', team: 5, round: 10 }],
    };
    const sportsbookSnapshot = {
      metadata: { season: 2026, capturedAt: '2026-08-12T00:00:00.000Z', importedAt: '2026-08-12T00:00:00.000Z', sourceDirectory: 'fixture', overUnderCount: 0, milestoneCount: 0 },
      overUnder: [],
      milestones: [], warnings: ['importer note'], decodeWarnings: ['spoof'],
    };
    const server = createSyncServer({
      draftData: { currentKeepers, sportsbookSnapshot },
    });
    const base = await listen(server);

    const headers = { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN };
    const keeperResponse = await fetch(
      `${base}/api/draft-data/current-keepers`,
      { headers }
    );
    const sportsbookResponse = await fetch(
      `${base}/api/draft-data/sportsbook`,
      { headers }
    );

    expect(keeperResponse.ok).toBe(true);
    expect(await keeperResponse.json()).toEqual(currentKeepers);
    expect(sportsbookResponse.ok).toBe(true);
    expect(await sportsbookResponse.json()).toEqual({ ...sportsbookSnapshot, decodeWarnings: [] });
  });

  it('rejects unconfigured extension origins before fetching Sleeper', async () => {
    let fetchCalls = 0;
    const server = createSyncServer({
      fetchJson: async (): Promise<unknown> => {
        fetchCalls += 1;
        return draftFixture;
      },
    });

    const base = await listen(server);

    const response = await fetch(`${base}/api/sync/drafts/fixture-draft`, {
      headers: { Origin: `chrome-extension://${'a'.repeat(32)}` },
    });

    expect(response.status).toBe(403);
    expect(fetchCalls).toBe(0);
  });

  it('reuses fresh sessions and evicts stale sessions without clients', async () => {
    const baseFetch = createMockFetchJson();
    let freshFetchCalls = 0;
    const freshServer = createSyncServer({
      fetchJson: async (url: string, signal: AbortSignal): Promise<unknown> => {
        freshFetchCalls += 1;
        return baseFetch(url, signal);
      },
      sessionStaleAfterMs: 60_000,
    });
    const freshBase = await listen(freshServer);
    const requestFresh = () => fetch(
      `${freshBase}/api/sync/drafts/fixture-draft`,
      { headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN } }
    );

    expect((await requestFresh()).ok).toBe(true);
    expect((await requestFresh()).ok).toBe(true);
    expect(freshFetchCalls).toBe(3);

    let staleFetchCalls = 0;
    const staleServer = createSyncServer({
      fetchJson: async (url: string, signal: AbortSignal): Promise<unknown> => {
        staleFetchCalls += 1;
        return baseFetch(url, signal);
      },
      sessionStaleAfterMs: 1,
    });
    const staleBase = await listen(staleServer);
    const requestStale = () => fetch(
      `${staleBase}/api/sync/drafts/fixture-draft`,
      { headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN } }
    );

    expect((await requestStale()).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await requestStale()).ok).toBe(true);
    expect(staleFetchCalls).toBe(6);
  });

  it('coalesces concurrent refreshes into fresh shared polls', async () => {
    const fixtureFetch = createMockFetchJson();
    let draftPolls = 0;
    let leagueLookups = 0;
    const server = createSyncServer({
      pollIntervalMs: 60_000,
      fetchJson: async (url: string, signal: AbortSignal): Promise<unknown> => {
        if (url.endsWith('/draft/fixture-draft')) draftPolls += 1;
        if (url.includes('/league/')) leagueLookups += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return fixtureFetch(url, signal);
      },
    });
    const base = await listen(server);

    const refresh = () => fetch(`${base}/api/sync/sleeper/drafts/fixture-draft/refresh`, {
      method: 'POST', headers: { 'X-Sync-Token': TOKEN },
    });
    const responses = await Promise.all(Array.from({ length: 6 }, refresh));
    expect(responses.every((response) => response.ok)).toBe(true);
    // The first refresh polls; the rest wait for it, then share one poll that
    // starts after their call, so each still verifies settings freshly.
    expect(draftPolls).toBe(2);
    expect(leagueLookups).toBe(2);
  });

  it('times out stalled Sleeper requests and clears the sync state', async () => {
    const server = createSyncServer({
      requestTimeoutMs: 5,
      fetchJson: (_url: string, signal: AbortSignal) => new Promise<unknown>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('Sleeper request timed out')); });
      }),
    });

    const base = await listen(server);

    const response = await fetch(`${base}/api/sync/drafts/fixture-draft`, {
      headers: { Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN },
    });
    const snapshot = decodeDraftSyncSnapshot(await response.json());

    expect(snapshot.status).toBe('error');
    expect(snapshot.lastError).toBe('Sleeper request timed out');
  });

  it('records each valid shadow recommendation decision once', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'fantasy-shadow-log-'));
    const shadowLogPath = join(temporaryDirectory, 'recommendations.ndjson');
    const server = createSyncServer({
      fetchJson: createMockFetchJson(),
      shadowLogPath,
    });
    const event = {
      eventId: '2026:sleeper:fixture-draft:1',
      season: 2027,
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

    const base = await listen(server);

    try {
      const post = () => fetch(`${base}/api/shadow-recommendations`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000', 'X-Sync-Token': TOKEN,
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
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe('draft session polling', () => {
  it('stops polling once the provider reports the draft complete', async () => {
    const fixtureFetch = createMockFetchJson();
    let draftStatus: 'drafting' | 'complete' = 'complete';
    let draftPolls = 0;
    const adapter = new SleeperSyncAdapter('fixture-draft', fixtureFetchJson(async (url: string, signal: AbortSignal): Promise<unknown> => {
      if (url.endsWith('/draft/fixture-draft')) {
        draftPolls += 1;
        return { ...draftFixture, status: draftStatus };
      }
      return fixtureFetch(url, signal);
    }));
    const runtime = ManagedRuntime.make(Layer.empty);
    // A 1 ms interval: a draft still in progress polls dozens of times while each check settles.
    const session = new syncServerInternals.DraftSession('sleeper', 'fixture-draft', adapter, 1, 1_000, 1 << 20, runtime);
    const frames: string[] = [];
    const client = new Writable({ write(chunk: Buffer, _encoding, callback) { frames.push(chunk.toString()); callback(); } });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

    try {
      session.addClient(client as unknown as ServerResponse);
      await vi.waitFor(() => { expect(session.getSnapshot().draft?.status).toBe('complete'); });
      await settle();
      expect(draftPolls).toBe(1);
      // Clients received the final snapshot before the loop stopped.
      expect(frames.some((frame) => frame.includes('"status":"complete"'))).toBe(true);

      // A manual refresh still reaches the provider, but does not restart the loop.
      await runtime.runPromise(session.refresh());
      await settle();
      expect(draftPolls).toBe(2);

      // A provider that reopens the draft resumes polling for connected clients.
      draftStatus = 'drafting';
      await runtime.runPromise(session.refresh());
      await vi.waitFor(() => { expect(draftPolls).toBeGreaterThan(5); });
    } finally {
      session.dispose();
      await runtime.dispose();
    }
  });
});

describe('provider HTTP requests', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('passes the decoder into the default transport and preserves its failure', async () => {
    const failure = new Error('Invalid provider draft ID');
    const decode = (value: unknown): string => {
      if (typeof value !== 'object' || value === null || !('draft_id' in value) || typeof value.draft_id !== 'string') {
        throw failure;
      }
      return value.draft_id;
    };
    const fetchMock = vi.fn(async () => Response.json(draftFixture));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await expect(syncServerInternals.defaultFetchJson('https://api.sleeper.app/v1/draft/fixture', signal, decode))
      .resolves.toBe(draftFixture.draft_id);
    fetchMock.mockImplementationOnce(async () => Response.json({}));
    await expect(syncServerInternals.defaultFetchJson('https://api.sleeper.app/v1/draft/fixture', signal, decode))
      .rejects.toBe(failure);
  });

  it.each([
    ['https://api.sleeper.app/v1/draft/fixture', 'Sleeper'],
    ['https://pub-api.fantasysports.yahoo.com/league/fixture', 'Yahoo'],
    ['https://fantasyfootballcalculator.com/api/v1/adp/ppr', 'Fantasy Football Calculator'],
  ])('preserves the provider status message for %s without retrying', async (url, provider) => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncServerInternals.defaultFetchJson(url, new AbortController().signal, decodeDraftSyncSnapshot))
      .rejects.toThrow(`${provider} request failed: 503`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Deadline and body cancellation belong to shared/src/http/runner.test.ts; this checks the provider label and the configured timeout.
  it('labels a stalled provider request as timed out after the configured timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream())));
    try {
      const request = syncServerInternals.defaultFetchJson('https://api.sleeper.app/v1/draft/fixture',
        new AbortController().signal, decodeDraftSyncSnapshot, {}, 50);
      const rejection = expect(request).rejects.toThrow('Sleeper request timed out');
      await vi.advanceTimersByTimeAsync(50);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('market ADP season default', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('requests the current NFL season and preserves explicit overrides', async () => {
    vi.useFakeTimers({ now: Date.parse('2027-02-28T23:59:59.999Z'), toFake: ['Date'] });
    const urls: string[] = [];
    const base = await listen(createSyncServer({ fetchJson: async url => {
      urls.push(url);
      return { status: 'Success', players: [] };
    } }));
    await fetch(`${base}/api/market-adp`, { headers: { 'X-Sync-Token': TOKEN } });
    expect(urls[0]).toContain('year=2026');
    await fetch(`${base}/api/market-adp?season=2024`, { headers: { 'X-Sync-Token': TOKEN } });
    expect(urls[1]).toContain('year=2024');
  });
});
