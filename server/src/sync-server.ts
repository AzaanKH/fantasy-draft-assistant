import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { DEFAULT_RESOURCE_LIMITS, hasRequestToken, HttpError, RequestBudget, writeBoundedEvent, type ResourceLimits } from './http-security.js';
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
  readonly limits?: Partial<ResourceLimits>;
  readonly sessionStaleAfterMs?: number;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly fetchJson?: FetchJson;
  readonly allowedOrigins?: readonly string[];
  readonly requestToken?: string;
  readonly shadowLogPath?: string;
  readonly draftData?: {
    readonly currentKeepers?: unknown;
    readonly sportsbookSnapshot?: unknown;
  };
}

function isChromeExtensionOrigin(origin: string): boolean {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

function isAllowedOrigin(
  origin: string,
  allowedOrigins: readonly string[]
): boolean {
  return allowedOrigins.includes(origin) || isChromeExtensionOrigin(origin);
}

export interface SyncServer extends Server {
  shutdown: (callback?: (error?: Error) => void) => void;
}

class DraftSession {
  private readonly adapter: DraftSyncAdapter | null;
  private engine: DraftSyncEngine;
  public lastActivityAt = Date.now();
  private readonly clients = new Map<number, ClientConnection>();
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private nextClientId = 1;
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInFlight: Promise<boolean> | null = null;
  private consecutiveFailures = 0;
  private lastIngestedAt: number | null = null;

  public constructor(
    provider: DraftProvider,
    draftId: string,
    adapter: DraftSyncAdapter | null,
    pollIntervalMs: number,
    requestTimeoutMs: number,
    private readonly maxBufferedBytes: number
  ) {
    this.adapter = adapter;
    this.engine = new DraftSyncEngine(provider, draftId);
    this.pollIntervalMs = pollIntervalMs;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  public getSnapshot(): DraftSyncSnapshot {
    return this.engine.getSnapshot();
  }

  public get clientCount(): number { return this.clients.size; }

  public get canEvict(): boolean { return this.clients.size === 0 && this.pollInFlight === null; }

  public reset(): DraftSyncSnapshot {
    const { provider, draftId } = this.engine.getSnapshot();
    this.engine = new DraftSyncEngine(provider, draftId);
    this.lastIngestedAt = null;
    this.lastActivityAt = Date.now();
    const snapshot = this.engine.getSnapshot();
    this.broadcast({ type: 'snapshot', snapshot });
    return snapshot;
  }

  public addClient(response: ServerResponse<IncomingMessage>): number {
    this.adapter?.invalidateSettings?.();
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
    this.lastActivityAt = Date.now();
    if (this.clients.size === 0) {
      this.stopPolling();
    }
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
    if (this.adapter) {
      // A reconnect must verify settings even if an older poll is finishing.
      if (this.pollInFlight) await this.pollInFlight;
      this.adapter.invalidateSettings?.();
      await this.pollOnce();
    }
    return this.engine.getSnapshot();
  }

  public ingest(
    draft: DraftMetadata,
    picks: readonly DraftPickEvent[],
    observedAt: number,
    now: number = Date.now()
  ): DraftSyncSnapshot {
    if (Math.abs(observedAt - now) > 5 * 60_000) {
      throw new HttpError(400, 'ESPN observation time must be within five minutes of the server clock');
    }
    if (this.lastIngestedAt !== null && observedAt < this.lastIngestedAt) {
      throw new HttpError(409, 'Stale ESPN snapshot');
    }
    // Failed reconciliation must not advance the ordering marker.
    const { snapshot, newPicks } = this.engine.reconcile(draft, picks, now);
    this.lastIngestedAt = observedAt;
    this.lastActivityAt = now;

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

    const failureBackoffMs = Math.min(
      this.pollIntervalMs * 2 ** this.consecutiveFailures,
      30_000
    );
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollOnce().then(() => this.scheduleNextPoll());
    }, failureBackoffMs);
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
      adapter.invalidateSettings?.();
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.broadcast({
        type: 'status',
        snapshot: this.engine.failSync(message),
      });
      this.consecutiveFailures += 1;
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private broadcast(update: DraftSyncUpdate): void {
    for (const { response } of this.clients.values()) {
      this.send(update, response);
    }
  }

  private send(update: DraftSyncUpdate, response: ServerResponse<IncomingMessage>): void {
    writeBoundedEvent(response, `data: ${JSON.stringify(update)}\n\n`, this.maxBufferedBytes);
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
  requestToken: string
): boolean {
  const origin = request.headers.origin;
  // Origins constrain browser callers; possession of the capability is always required.
  return (!origin || isAllowedOrigin(origin, allowedOrigins)) && hasRequestToken(request, requestToken);
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
  response.setHeader('Cache-Control', 'no-store');
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
  isReset: boolean;
} | null {
  const providerMatch = pathname.match(
    /^\/api\/sync\/(sleeper|yahoo|espn)\/drafts\/([^/]+)(?:\/(events|refresh|snapshot|reset))?$/
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

  return {
    provider,
    draftId: decodeURIComponent(encodedDraftId),
    isStream: action === 'events',
    isRefresh: action === 'refresh',
    isSnapshot: action === 'snapshot',
    isReset: action === 'reset',
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
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
  const requestToken = options.requestToken ?? randomBytes(32).toString('base64url');
  const limits = { ...DEFAULT_RESOURCE_LIMITS, ...(options.sessionStaleAfterMs === undefined ? {} : { idleSessionMs: options.sessionStaleAfterMs }), ...options.limits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Resource limits must be positive integers');
  }
  const requestBudget = new RequestBudget(limits.requestsPerMinute);
  let concurrentRequests = 0;
  const sessions = new Map<string, DraftSession>();
  const pollIntervalMs = Math.max(1000, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const allowedOrigins = options.allowedOrigins?.length
    ? options.allowedOrigins
    : ['http://localhost:3000'];
  const shadowLogger = new ShadowRecommendationLogger(
    options.shadowLogPath ?? DEFAULT_SHADOW_LOG_PATH
  );
  const marketAdpProvider = new FantasyFootballCalculatorAdpProvider(fetchJson);

  function evictIdleSessions(): void {
    const cutoff = Date.now() - limits.idleSessionMs;
    for (const [key, session] of sessions) {
      if (session.canEvict && session.lastActivityAt <= cutoff) {
        session.dispose();
        sessions.delete(key);
      }
    }
  }

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

  function getSession(
    provider: DraftProvider,
    draftId: string
  ): DraftSession {
    const sessionKey = `${provider}:${draftId}`;
    let session = sessions.get(sessionKey);
    if (!session) {
      evictIdleSessions();
      if (sessions.size >= limits.maxSessions) {
        throw new HttpError(429, 'Too many draft sessions; close unused drafts and retry after the idle timeout');
      }
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
        limits.maxBufferedBytes
      );
      sessions.set(sessionKey, session);
    }
    session.lastActivityAt = Date.now();
    return session;
  }

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<void> {
    if (!request.url || !request.method) {
      sendNotFound(request, response, allowedOrigins);
      return;
    }

    let url: URL;
    try {
      url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
    } catch {
      sendJson(request, response, 400, { error: 'Invalid request URL' }, allowedOrigins);
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(request, response, 200, { ok: true }, allowedOrigins);
      return;
    }

    // Preflight grants no access to data and carries no capability header value.
    if (request.method === 'OPTIONS') {
      const origin = request.headers.origin;
      if (!origin || !isAllowedOrigin(origin, allowedOrigins)) {
        sendForbidden(request, response, allowedOrigins);
        return;
      }
      setCorsHeaders(request, response, allowedOrigins);
      response.statusCode = 204;
      response.end();
      return;
    }

    if (!isAuthorizedRequest(request, allowedOrigins, requestToken)) {
      sendForbidden(request, response, allowedOrigins);
      return;
    }

    if (url.pathname === '/api/auth/check' && request.method === 'GET') {
      sendJson(request, response, 200, { ok: true }, allowedOrigins);
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
        if (error instanceof HttpError) throw error;
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
      } catch (error) {
        if (error instanceof HttpError) throw error;
        sendJson(request, response, 500, { error: 'Failed to persist shadow recommendation' }, allowedOrigins);
      }
      return;
    }

    let route: ReturnType<typeof parseDraftRoute>;
    try {
      route = parseDraftRoute(url.pathname);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      sendJson(request, response, 400, { error: 'Invalid draft ID' }, allowedOrigins);
      return;
    }
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

    const hasValidAction = route.isSnapshot || route.isReset
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

    if (route.isSnapshot && request.method === 'POST') {
      if (route.provider !== 'espn') {
        sendNotFound(request, response, allowedOrigins);
        return;
      }

      let payload: unknown;
      try {
        payload = await readJsonBody(request);
      } catch (error) {
        if (error instanceof HttpError) throw error;
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
      // Reject bogus clocks before allocating a session.
      if (Math.abs(espnPayload.observedAt - Date.now()) > 5 * 60_000) {
        throw new HttpError(400, 'ESPN observation time must be within five minutes of the server clock');
      }
      const session = getSession(route.provider, route.draftId);
      const snapshot = session.ingest(
        espnPayload.draft,
        espnPayload.picks,
        espnPayload.observedAt
      );
      sendJson(request, response, 200, snapshot, allowedOrigins);
      return;
    }

    if (route.isStream && request.method === 'GET') {
      const clientCount = [...sessions.values()].reduce((count, session) => count + session.clientCount, 0);
      if (clientCount >= limits.maxClients) throw new HttpError(429, 'Too many event streams');
      const session = getSession(route.provider, route.draftId);
      if (session.clientCount >= limits.maxClientsPerSession) throw new HttpError(429, 'Too many streams for this draft');
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
      const session = getSession(route.provider, route.draftId);
      const snapshot = await session.refresh();
      sendJson(request, response, 200, snapshot, allowedOrigins);
      return;
    }

    if (route.isReset && route.provider === 'espn' && request.method === 'POST') {
      sendJson(request, response, 200, getSession(route.provider, route.draftId).reset(), allowedOrigins);
      return;
    }

    if (
      !route.isStream &&
      !route.isRefresh &&
      !route.isSnapshot &&
      !route.isReset &&
      request.method === 'GET'
    ) {
      const session = getSession(route.provider, route.draftId);
      const snapshot = session.getSnapshot();
      if (snapshot.status === 'idle') {
        await session.refresh();
      }
      sendJson(request, response, 200, session.getSnapshot(), allowedOrigins);
      return;
    }

    sendNotFound(request, response, allowedOrigins);
  }

  const server = createServer((request, response) => {
    if (!requestBudget.take() || concurrentRequests >= limits.maxConcurrentRequests) {
      response.setHeader('Retry-After', '60');
      sendJson(request, response, 429, { error: 'Local sync request limit reached' }, allowedOrigins);
      request.resume();
      return;
    }
    concurrentRequests += 1;
    let released = false;
    const release = () => {
      if (!released) { concurrentRequests -= 1; released = true; }
    };
    response.once('close', release);
    response.once('finish', release);
    void handleRequest(request, response).catch((error: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) {
        if (error.status === 429) response.setHeader('Retry-After', '60');
        sendJson(request, response, error.status, { error: error.message }, allowedOrigins);
        return;
      }
      console.error('[sync-server] Request failed', error);
      sendJson(request, response, 500, { error: 'Internal server error' }, allowedOrigins);
    }).finally(release);
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = limits.maxConnections;
  const evictionTimer = setInterval(evictIdleSessions, Math.min(limits.idleSessionMs, 60_000));
  evictionTimer.unref();

  const disposeSessions = () => {
    clearInterval(evictionTimer);
    for (const session of sessions.values()) {
      session.dispose();
    }
    sessions.clear();
  };
  server.once('close', disposeSessions);

  const syncServer = server as SyncServer;
  syncServer.shutdown = (callback) => {
    disposeSessions();
    server.close(callback);
  };

  return syncServer;
}
