import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  DraftSyncEngine,
  isEspnDraftSnapshot,
  isMarketAdpFormat,
  isShadowRecommendationEvent,
  type DraftMetadata,
  type DraftPickEvent,
  type DraftProvider,
  type DraftSyncSnapshot,
  type DraftSyncUpdate,
  type EspnDraftSnapshot,
  type ShadowRecommendationEvent,
} from '@fantasy-draft/shared';
import { ShadowRecommendationLogger } from './shadow-logger.js';
import {
  SleeperSyncAdapter,
  SLEEPER_API_BASE,
} from './sleeper-adapter.js';
import type {
  DraftSyncAdapter,
  FetchJson,
} from './sync-adapter.js';
import { YahooSyncAdapter } from './yahoo-adapter.js';
import { FantasyFootballCalculatorAdpProvider } from './fantasy-football-calculator.js';

export { SLEEPER_API_BASE };
export type { FetchJson };

export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SESSION_STALE_AFTER_MS = 5 * 60_000;
export const DEFAULT_SHADOW_LOG_PATH = fileURLToPath(
  new URL('../../data/shadow-logs/2026-recommendations.ndjson', import.meta.url)
);
const DEFAULT_CURRENT_KEEPERS_PATH = fileURLToPath(
  new URL('../../data/league-history/current-keepers.json', import.meta.url)
);
const DEFAULT_SPORTSBOOK_SNAPSHOT_PATH = fileURLToPath(
  new URL('../../data/sportsbook-snapshot.json', import.meta.url)
);
const MAX_JSON_BODY_BYTES = 256 * 1024;

interface ClientConnection {
  readonly id: number;
  readonly response: ServerResponse<IncomingMessage>;
}

interface SyncServerOptions {
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly sessionStaleAfterMs?: number;
  readonly fetchJson?: FetchJson;
  readonly allowedOrigins?: readonly string[];
  readonly requestToken?: string;
  readonly shadowLogPath?: string;
  readonly draftData?: {
    readonly currentKeepers?: unknown;
    readonly sportsbookSnapshot?: unknown;
  };
}

function isAllowedOrigin(
  origin: string,
  allowedOrigins: readonly string[]
): boolean {
  return allowedOrigins.includes(origin);
}

export interface SyncServer extends Server {
  shutdown: (callback?: (error?: Error) => void) => void;
}

class DraftSession {
  private readonly adapter: DraftSyncAdapter | null;
  private readonly engine: DraftSyncEngine;
  private readonly clients = new Map<number, ClientConnection>();
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private nextClientId = 1;
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInFlight: Promise<boolean> | null = null;
  private consecutiveFailures = 0;
  private lastIngestedAt: number | null = null;
  private lastActivityAt = Date.now();

  public constructor(
    provider: DraftProvider,
    draftId: string,
    adapter: DraftSyncAdapter | null,
    pollIntervalMs: number,
    requestTimeoutMs: number,
    private readonly onIdle: () => void
  ) {
    this.adapter = adapter;
    this.engine = new DraftSyncEngine(provider, draftId);
    this.pollIntervalMs = pollIntervalMs;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  public getSnapshot(): DraftSyncSnapshot {
    return this.engine.getSnapshot();
  }

  public addClient(response: ServerResponse<IncomingMessage>): number {
    const id = this.nextClientId++;
    this.clients.set(id, { id, response });
    if (this.adapter) this.ensurePolling();
    this.send(
      {
        type: 'snapshot',
        snapshot: this.engine.getSnapshot(),
      },
      response
    );
    return id;
  }

  public removeClient(id: number): void {
    this.clients.delete(id);
    if (this.clients.size === 0) {
      this.stopPolling();
      this.onIdle();
    }
  }

  public isStale(staleAfterMs: number, now: number = Date.now()): boolean {
    if (this.clients.size > 0) return false;
    return now - this.lastActivityAt >= staleAfterMs;
  }

  public dispose(): void {
    this.stopPolling();
    for (const { response } of this.clients.values()) {
      if (!response.writableEnded) {
        try {
          response.end();
        } catch {
          // A peer may close between the writable check and end().
        }
      }
    }
    this.clients.clear();
  }

  public async refresh(): Promise<DraftSyncSnapshot> {
    if (this.adapter) await this.pollOnce();
    this.lastActivityAt = Date.now();
    return this.engine.getSnapshot();
  }

  public ingest(
    draft: DraftMetadata,
    picks: readonly DraftPickEvent[],
    now: number = Date.now()
  ): DraftSyncSnapshot {
    if (this.lastIngestedAt !== null && now < this.lastIngestedAt) {
      return this.engine.getSnapshot();
    }
    this.lastIngestedAt = now;
    this.lastActivityAt = Date.now();
    const { snapshot, newPicks } = this.engine.reconcile(draft, picks, now);

    for (const pick of newPicks) {
      this.broadcast({ type: 'pick', snapshot, pick });
    }
    this.broadcast({ type: 'snapshot', snapshot });
    return snapshot;
  }

  private ensurePolling(): void {
    if (!this.adapter || this.pollTimer !== null) {
      return;
    }

    void this.pollOnce().then(() => this.scheduleNextPoll());
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private scheduleNextPoll(): void {
    if (!this.adapter || this.clients.size === 0 || this.pollTimer !== null) {
      return;
    }

    const nextDelayMs = Math.min(
      this.pollIntervalMs * 2 ** this.consecutiveFailures,
      30_000
    );
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollOnce().then(() => this.scheduleNextPoll());
    }, nextDelayMs);
  }

  private pollOnce(): Promise<boolean> {
    if (this.pollInFlight) {
      return this.pollInFlight;
    }

    this.pollInFlight = this.performPoll().finally(() => {
      this.pollInFlight = null;
    });
    return this.pollInFlight;
  }

  private async performPoll(): Promise<boolean> {
    const adapter = this.adapter;
    if (!adapter) return false;

    this.broadcast({
      type: 'status',
      snapshot: this.engine.beginSync(),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const adapterSnapshot = await adapter.poll(controller.signal);
      const { snapshot, newPicks } = this.engine.reconcile(
        adapterSnapshot.draft,
        adapterSnapshot.picks
      );

      for (const pick of newPicks) {
        this.broadcast({
          type: 'pick',
          snapshot,
          pick,
        });
      }

      this.broadcast({
        type: 'snapshot',
        snapshot,
      });
      this.consecutiveFailures = 0;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.broadcast({
        type: 'status',
        snapshot: this.engine.failSync(message),
      });
      this.consecutiveFailures += 1;
      return false;
    } finally {
      clearTimeout(timeout);
      this.lastActivityAt = Date.now();
    }
  }

  private broadcast(update: DraftSyncUpdate): void {
    for (const { response } of this.clients.values()) {
      this.send(update, response);
    }
  }

  private send(update: DraftSyncUpdate, response: ServerResponse<IncomingMessage>): void {
    response.write(`data: ${JSON.stringify(update)}\n\n`);
  }
}

function setCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  allowedOrigins: readonly string[]
): void {
  const origin = request.headers.origin;
  if (origin && isAllowedOrigin(origin, allowedOrigins)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Sync-Token');
}

function isAuthorizedRequest(
  request: IncomingMessage,
  allowedOrigins: readonly string[],
  requestToken: string | undefined
): boolean {
  const origin = request.headers.origin;
  if (origin && isAllowedOrigin(origin, allowedOrigins)) {
    return true;
  }

  const token = request.headers['x-sync-token'];
  return typeof token === 'string' && requestToken !== undefined && token === requestToken;
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown,
  allowedOrigins: readonly string[]
): void {
  setCorsHeaders(request, response, allowedOrigins);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function sendNotFound(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  allowedOrigins: readonly string[]
): void {
  sendJson(request, response, 404, { error: 'Not found' }, allowedOrigins);
}

function sendForbidden(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  allowedOrigins: readonly string[]
): void {
  sendJson(request, response, 403, { error: 'Forbidden' }, allowedOrigins);
}

function parseDraftRoute(pathname: string): {
  provider: DraftProvider;
  draftId: string;
  isStream: boolean;
  isRefresh: boolean;
  isSnapshot: boolean;
} | null {
  const providerMatch = pathname.match(
    /^\/api\/sync\/(sleeper|yahoo|espn)\/drafts\/([^/]+)(?:\/(events|refresh|snapshot))?$/
  );
  const legacyMatch = pathname.match(
    /^\/api\/sync\/drafts\/([^/]+)(?:\/(events|refresh))?$/
  );
  if (!providerMatch && !legacyMatch) {
    return null;
  }

  const provider = (providerMatch?.[1] ?? 'sleeper') as DraftProvider;
  const encodedDraftId = providerMatch?.[2] ?? legacyMatch?.[1];
  const action = providerMatch?.[3] ?? legacyMatch?.[2];
  if (!encodedDraftId) return null;

  let draftId: string;
  try {
    draftId = decodeURIComponent(encodedDraftId);
  } catch {
    draftId = '';
  }

  return {
    provider,
    draftId,
    isStream: action === 'events',
    isRefresh: action === 'refresh',
    isSnapshot: action === 'snapshot',
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > MAX_JSON_BODY_BYTES) {
      throw new Error('Request body is too large');
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) throw new Error('Request body is required');
  return JSON.parse(body) as unknown;
}

export async function defaultFetchJson<T>(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, { ...init, signal });

  if (!response.ok) {
    const hostname = new URL(url).hostname;
    const provider = hostname.includes('yahoo')
      ? 'Yahoo'
      : hostname.includes('fantasyfootballcalculator')
        ? 'Fantasy Football Calculator'
        : 'Sleeper';
    throw new Error(`${provider} request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function createSyncServer(options: SyncServerOptions = {}): SyncServer {
  const sessions = new Map<string, DraftSession>();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const sessionStaleAfterMs =
    options.sessionStaleAfterMs ?? DEFAULT_SESSION_STALE_AFTER_MS;
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const allowedOrigins = options.allowedOrigins?.length
    ? options.allowedOrigins
    : ['http://localhost:3000'];
  const shadowLogger = new ShadowRecommendationLogger(
    options.shadowLogPath ?? DEFAULT_SHADOW_LOG_PATH
  );
  const marketAdpProvider = new FantasyFootballCalculatorAdpProvider(fetchJson);

  async function loadDraftData(
    kind: 'currentKeepers' | 'sportsbookSnapshot'
  ): Promise<unknown> {
    const provided = options.draftData?.[kind];
    if (provided !== undefined) return provided;
    const filePath = kind === 'currentKeepers'
      ? DEFAULT_CURRENT_KEEPERS_PATH
      : DEFAULT_SPORTSBOOK_SNAPSHOT_PATH;
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  }

  function evictStaleSessions(now: number = Date.now()): void {
    for (const [sessionKey, session] of sessions) {
      if (session.isStale(sessionStaleAfterMs, now)) {
        session.dispose();
        sessions.delete(sessionKey);
      }
    }
  }

  function getSession(
    provider: DraftProvider,
    draftId: string
  ): DraftSession {
    evictStaleSessions();
    const sessionKey = `${provider}:${draftId}`;
    let session = sessions.get(sessionKey);
    if (!session) {
      const adapter: DraftSyncAdapter | null =
        provider === 'espn'
          ? null
          : provider === 'yahoo'
            ? new YahooSyncAdapter(draftId, fetchJson)
            : new SleeperSyncAdapter(draftId, fetchJson);
      session = new DraftSession(
        provider,
        draftId,
        adapter,
        pollIntervalMs,
        requestTimeoutMs,
        evictStaleSessions
      );
      sessions.set(sessionKey, session);
    }

    return session;
  }

  const server = createServer(async (request, response) => {
    if (!request.url || !request.method) {
      sendNotFound(request, response, allowedOrigins);
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname === '/api/health') {
      sendJson(request, response, 200, { ok: true }, allowedOrigins);
      return;
    }

    if (!isAuthorizedRequest(request, allowedOrigins, options.requestToken)) {
      sendForbidden(request, response, allowedOrigins);
      return;
    }

    if (request.method === 'OPTIONS') {
      setCorsHeaders(request, response, allowedOrigins);
      response.statusCode = 204;
      response.end();
      return;
    }

    const draftDataKind = url.pathname === '/api/draft-data/current-keepers'
      ? 'currentKeepers'
      : url.pathname === '/api/draft-data/sportsbook'
        ? 'sportsbookSnapshot'
        : null;
    if (draftDataKind && request.method === 'GET') {
      try {
        sendJson(
          request,
          response,
          200,
          await loadDraftData(draftDataKind),
          allowedOrigins
        );
      } catch {
        sendJson(
          request,
          response,
          503,
          { error: 'Draft data is unavailable' },
          allowedOrigins
        );
      }
      return;
    }

    if (url.pathname === '/api/market-adp' && request.method === 'GET') {
      const format = url.searchParams.get('format') ?? 'ppr';
      const teams = Number(url.searchParams.get('teams') ?? '10');
      const season = Number(url.searchParams.get('season') ?? String(new Date().getFullYear()));
      if (
        !isMarketAdpFormat(format) ||
        !Number.isInteger(teams) ||
        teams < 8 ||
        teams > 14 ||
        !Number.isInteger(season) ||
        season < 2020 ||
        season > 2100
      ) {
        sendJson(request, response, 400, { error: 'Invalid market ADP query' }, allowedOrigins);
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const snapshot = await marketAdpProvider.getSnapshot(
          format,
          teams,
          season,
          controller.signal
        );
        sendJson(request, response, 200, snapshot, allowedOrigins);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Market ADP request failed';
        sendJson(request, response, 502, { error: message }, allowedOrigins);
      } finally {
        clearTimeout(timeout);
      }
      return;
    }

    if (url.pathname === '/api/shadow-recommendations' && request.method === 'POST') {
      let event: unknown;
      try {
        event = await readJsonBody(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid request body';
        sendJson(request, response, 400, { error: message }, allowedOrigins);
        return;
      }
      if (!isShadowRecommendationEvent(event)) {
        sendJson(request, response, 400, { error: 'Invalid shadow recommendation event' }, allowedOrigins);
        return;
      }

      const shadowEvent = event as ShadowRecommendationEvent;
      try {
        const eventId = shadowEvent.eventId;
        const recorded = await shadowLogger.record(shadowEvent);
        sendJson(
          request,
          response,
          recorded ? 201 : 200,
          { eventId, recorded },
          allowedOrigins
        );
      } catch {
        sendJson(request, response, 500, { error: 'Failed to persist shadow recommendation' }, allowedOrigins);
      }
      return;
    }

    const route = parseDraftRoute(url.pathname);
    if (!route) {
      sendNotFound(request, response, allowedOrigins);
      return;
    }

    const isValidDraftId =
      route.provider === 'yahoo' || route.provider === 'espn'
        ? /^\d{1,20}$/.test(route.draftId)
        : /^[A-Za-z0-9_-]{1,128}$/.test(route.draftId);
    if (!isValidDraftId) {
      sendJson(request, response, 400, { error: 'Invalid draft ID' }, allowedOrigins);
      return;
    }

    const hasValidAction = route.isSnapshot
      ? route.provider === 'espn' && request.method === 'POST'
      : route.isStream
        ? request.method === 'GET'
        : route.isRefresh
          ? request.method === 'POST'
          : request.method === 'GET';
    if (!hasValidAction) {
      sendNotFound(request, response, allowedOrigins);
      return;
    }

    const session = getSession(route.provider, route.draftId);

    if (route.isSnapshot && request.method === 'POST') {
      let payload: unknown;
      try {
        payload = await readJsonBody(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid request body';
        sendJson(request, response, 400, { error: message }, allowedOrigins);
        return;
      }

      if (!isEspnDraftSnapshot(payload)) {
        sendJson(request, response, 400, { error: 'Invalid ESPN draft snapshot' }, allowedOrigins);
        return;
      }
      const espnPayload = payload as EspnDraftSnapshot;
      if (espnPayload.draft.draftId !== route.draftId) {
        sendJson(request, response, 400, { error: 'Invalid ESPN draft snapshot' }, allowedOrigins);
        return;
      }

      const snapshot = session.ingest(
        espnPayload.draft,
        espnPayload.picks,
        espnPayload.observedAt
      );
      sendJson(request, response, 200, snapshot, allowedOrigins);
      return;
    }

    if (route.isStream && request.method === 'GET') {
      setCorsHeaders(request, response, allowedOrigins);
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      const clientId = session.addClient(response);

      request.on('close', () => {
        session.removeClient(clientId);
        response.end();
      });

      return;
    }

    if (route.isRefresh && request.method === 'POST') {
      const snapshot = await session.refresh();
      sendJson(request, response, 200, snapshot, allowedOrigins);
      return;
    }

    if (
      !route.isStream &&
      !route.isRefresh &&
      !route.isSnapshot &&
      request.method === 'GET'
    ) {
      const snapshot = session.getSnapshot();
      if (snapshot.status === 'idle') {
        await session.refresh();
      }
      sendJson(request, response, 200, session.getSnapshot(), allowedOrigins);
      return;
    }

    sendNotFound(request, response, allowedOrigins);
  });

  const disposeSessions = () => {
    for (const session of sessions.values()) {
      session.dispose();
    }
    sessions.clear();
  };

  const syncServer = server as SyncServer;
  syncServer.shutdown = (callback) => {
    disposeSessions();
    server.close(callback);
  };

  return syncServer;
}
