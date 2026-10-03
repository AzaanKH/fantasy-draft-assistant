import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Cause, Effect, Fiber, Semaphore } from 'effect';
import { attempt, DEFAULT_RESOURCE_LIMITS, hasRequestToken, HttpError, RequestBudget, writeBoundedEvent, type ResourceLimits } from './http-security.js';
import {
  DraftSyncEngine,
  isEspnDraftSnapshot,
  isMarketAdpFormat,
  isShadowRecommendationEvent,
  type DraftMetadata,
  type DraftSessionSummary,
  type DraftPickEvent,
  type DraftProvider,
  type DraftSyncSnapshot,
  type DraftSyncUpdate,
} from '@fantasy-draft/shared';
import { ShadowRecommendationLogger } from './shadow-logger.js';
import {
  SleeperSyncAdapter,
  SLEEPER_API_BASE,
} from './sleeper-adapter.js';
import {
  ProviderError,
  type DraftSyncAdapter,
  type FetchJson,
} from './sync-adapter.js';
import { YahooSyncAdapter } from './yahoo-adapter.js';
import { DraftDataRefreshJob, type RunRefreshScript } from './draft-data-refresh.js';
import { FantasyFootballCalculatorAdpProvider } from './fantasy-football-calculator.js';

export { SLEEPER_API_BASE };
export type { FetchJson };

export const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SHADOW_LOG_PATH = fileURLToPath(
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
  readonly response: ServerResponse;
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
  /** Replaces the package-script runner for the Core Draft Data refresh, for tests. */
  readonly runRefreshScript?: RunRefreshScript;
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
  private pollFiber: Fiber.Fiber<void> | null = null;
  private pollSleeping = false;
  // Polls never overlap, so a reconnect's verification poll waits for any poll in progress.
  private readonly pollPermit = Semaphore.makeUnsafe(1);
  private pollsPending = 0;
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

  public get canEvict(): boolean { return this.clients.size === 0 && this.pollsPending === 0; }

  public reset(): DraftSyncSnapshot {
    const { provider, draftId } = this.engine.getSnapshot();
    this.engine = new DraftSyncEngine(provider, draftId);
    this.lastIngestedAt = null;
    this.lastActivityAt = Date.now();
    const snapshot = this.engine.getSnapshot();
    this.broadcast({ type: 'snapshot', snapshot });
    return snapshot;
  }

  public addClient(response: ServerResponse): number {
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
    if (this.pollFiber) Effect.runFork(Fiber.interrupt(this.pollFiber));
    this.pollFiber = null;
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

  public refresh(): Effect.Effect<DraftSyncSnapshot> {
    return Effect.gen({ self: this }, function* () {
      // A reconnect must verify settings even if an older poll is finishing.
      if (this.adapter) yield* this.pollOnce({ invalidateSettings: true });
      return this.engine.getSnapshot();
    });
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
    if (!this.adapter || this.pollFiber !== null) {
      return;
    }
    let finished = false;
    const fiber: Fiber.Fiber<void> = Effect.runFork(this.pollLoop().pipe(Effect.ensuring(Effect.sync(() => {
      finished = true;
      // pollFiber is still null if the loop ended before runFork returned, so fiber is never read early.
      if (this.pollFiber !== null && this.pollFiber === fiber) this.pollFiber = null;
    }))));
    if (!finished) this.pollFiber = fiber;
  }

  /** Stop between polls; a poll in progress finishes and the loop then sees no clients. */
  private stopPolling(): void {
    if (this.pollFiber !== null && this.pollSleeping) {
      Effect.runFork(Fiber.interrupt(this.pollFiber));
      this.pollFiber = null;
    }
  }

  private pollLoop(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      for (;;) {
        yield* this.pollOnce({ invalidateSettings: false });
        if (this.clients.size === 0) return;
        this.pollSleeping = true;
        yield* Effect.sleep(Math.min(this.pollIntervalMs * 2 ** this.consecutiveFailures, 30_000)).pipe(
          Effect.ensuring(Effect.sync(() => { this.pollSleeping = false; })),
        );
      }
    });
  }

  private pollOnce(options: { readonly invalidateSettings: boolean }): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      this.pollsPending += 1;
      return this.pollPermit.withPermits(1)(Effect.suspend(() => {
        if (options.invalidateSettings) this.adapter?.invalidateSettings?.();
        return this.performPoll();
      })).pipe(Effect.ensuring(Effect.sync(() => { this.pollsPending -= 1; })));
    });
  }

  private performPoll(): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const adapter = this.adapter;
      if (!adapter) return false;

      const wasSynced = this.engine.getSnapshot().status === 'synced';
      const syncingSnapshot = this.engine.beginSync();
      if (!wasSynced) {
        this.broadcast({ type: 'status', snapshot: syncingSnapshot });
      }

      const providerName = adapter.provider === 'yahoo' ? 'Yahoo' : 'Sleeper';
      const polled = yield* adapter.poll().pipe(
        Effect.timeoutOrElse({
          duration: this.requestTimeoutMs,
          orElse: () => Effect.fail(new ProviderError({ message: `${providerName} request timed out` })),
        }),
        Effect.flatMap((adapterSnapshot) => Effect.try({
          try: () => {
            const polledAt = Date.now();
            return { polledAt, ...this.engine.reconcile(adapterSnapshot.draft, adapterSnapshot.picks, polledAt) };
          },
          catch: (cause) => new ProviderError({ message: cause instanceof Error ? cause.message : 'Unknown sync error', cause }),
        })),
        Effect.result,
      );

      if (polled._tag === 'Failure') {
        adapter.invalidateSettings?.();
        this.broadcast({
          type: 'status',
          snapshot: this.engine.failSync(polled.failure.message),
        });
        this.consecutiveFailures += 1;
        return false;
      }

      const { snapshot, newPicks, changed, polledAt } = polled.success;
      for (const pick of newPicks) {
        this.broadcast({
          type: 'pick',
          snapshot,
          pick,
        });
      }

      if (changed) {
        this.broadcast({ type: 'snapshot', snapshot });
      } else {
        this.broadcast({
          type: 'heartbeat',
          provider: snapshot.provider,
          draftId: snapshot.draftId,
          lastPolledAt: polledAt,
          lastSuccessfulSyncAt: polledAt,
        });
      }
      this.consecutiveFailures = 0;
      return true;
    });
  }

  private broadcast(update: DraftSyncUpdate): void {
    for (const { response } of this.clients.values()) {
      this.send(update, response);
    }
  }

  private send(update: DraftSyncUpdate, response: ServerResponse): void {
    writeBoundedEvent(response, `data: ${JSON.stringify(update)}\n\n`, this.maxBufferedBytes);
  }
}

function setCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
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
  response: ServerResponse,
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
  response: ServerResponse,
  allowedOrigins: readonly string[]
): void {
  sendJson(request, response, 404, { error: 'Not found' }, allowedOrigins);
}

function sendForbidden(
  request: IncomingMessage,
  response: ServerResponse,
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

/** Every body problem is the client's, so report it as a 400 with the reason. */
function readJsonBody(request: IncomingMessage): Effect.Effect<unknown, HttpError> {
  return Effect.gen(function* () {
    if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return yield* new HttpError(415, 'Content-Type must be application/json');
    }
    const body = yield* Effect.tryPromise({
      try: async () => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        for await (const chunk of request as AsyncIterable<Buffer | string>) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > MAX_JSON_BODY_BYTES) throw new Error('Request body is too large');
          chunks.push(buffer);
        }
        return Buffer.concat(chunks).toString('utf8');
      },
      catch: (error) => new HttpError(400, error instanceof Error ? error.message : 'Invalid request body'),
    });
    if (!body) return yield* new HttpError(400, 'Request body is required');
    return yield* Effect.try({
      try: () => JSON.parse(body) as unknown,
      catch: (error) => new HttpError(400, error instanceof Error ? error.message : 'Invalid request body'),
    });
  });
}

async function defaultFetchJson<T>(
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
  const draftDataRefresh = new DraftDataRefreshJob(options.runRefreshScript);

  function evictIdleSessions(): void {
    const cutoff = Date.now() - limits.idleSessionMs;
    for (const [key, session] of sessions) {
      if (session.canEvict && session.lastActivityAt <= cutoff) {
        session.dispose();
        sessions.delete(key);
      }
    }
  }

  function loadDraftData(
    kind: 'currentKeepers' | 'sportsbookSnapshot'
  ): Effect.Effect<unknown, HttpError> {
    const provided = options.draftData?.[kind];
    if (provided !== undefined) return Effect.succeed(provided);
    const filePath = kind === 'currentKeepers'
      ? DEFAULT_CURRENT_KEEPERS_PATH
      : DEFAULT_SPORTSBOOK_SNAPSHOT_PATH;
    return Effect.tryPromise({
      try: async () => JSON.parse(await readFile(filePath, 'utf8')) as unknown,
      catch: () => new HttpError(503, 'Draft data is unavailable'),
    });
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

  const handleRequest = Effect.fn('handleRequest')(function* (
    request: IncomingMessage,
    response: ServerResponse
  ) {
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

    if (url.pathname === '/api/sync/sessions' && request.method === 'GET') {
      evictIdleSessions();
      const retained = [...sessions.entries()].map(([sessionId, session]): DraftSessionSummary => {
        const snapshot = session.getSnapshot();
        const draft = snapshot.draft;
        const totalPicks = draft ? draft.settings.teams * draft.settings.rounds : 0;
        const occupied = new Set(snapshot.picks.map((pick: DraftPickEvent) => pick.pickNumber));
        let currentPick = 1;
        while (currentPick <= totalPicks && occupied.has(currentPick)) currentPick += 1;
        return { session: sessionId, provider: snapshot.provider, draftId: snapshot.draftId,
          draftStatus: draft?.status ?? null, draftType: draft?.type ?? null,
          totalTeams: draft?.settings.teams ?? null, totalRounds: draft?.settings.rounds ?? null,
          currentPick: draft ? draft.status === 'complete' ? totalPicks + 1 : currentPick : null,
          picksRecorded: snapshot.picks.length,
          sync: { state: snapshot.status, lastSuccessfulSyncAt: snapshot.lastSuccessfulSyncAt, lastError: snapshot.lastError },
          lastActivityAt: session.lastActivityAt, subscribers: session.clientCount };
      }).sort((left, right) => left.session.localeCompare(right.session));
      sendJson(request, response, 200, { sessions: retained }, allowedOrigins);
      return;
    }

    if (url.pathname === '/api/draft-data/refresh') {
      if (request.method === 'GET') {
        sendJson(request, response, 200, draftDataRefresh.getStatus(), allowedOrigins);
      } else if (request.method === 'POST') {
        sendJson(request, response, 202, draftDataRefresh.start(), allowedOrigins);
      } else {
        sendNotFound(request, response, allowedOrigins);
      }
      return;
    }

    const draftDataKind = url.pathname === '/api/draft-data/current-keepers'
      ? 'currentKeepers'
      : url.pathname === '/api/draft-data/sportsbook'
        ? 'sportsbookSnapshot'
        : null;
    if (draftDataKind && request.method === 'GET') {
      sendJson(request, response, 200, yield* loadDraftData(draftDataKind), allowedOrigins);
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

      const snapshot = yield* marketAdpProvider.getSnapshot(format, teams, season).pipe(
        Effect.timeoutOrElse({
          duration: requestTimeoutMs,
          orElse: () => Effect.fail(new ProviderError({ message: 'Fantasy Football Calculator request timed out' })),
        }),
        Effect.mapError((error) => new HttpError(502, error.message)),
      );
      sendJson(request, response, 200, snapshot, allowedOrigins);
      return;
    }

    if (url.pathname === '/api/shadow-recommendations' && request.method === 'POST') {
      const event = yield* readJsonBody(request);
      if (!isShadowRecommendationEvent(event)) {
        sendJson(request, response, 400, { error: 'Invalid shadow recommendation event' }, allowedOrigins);
        return;
      }

      const recorded = yield* shadowLogger.record(event).pipe(Effect.catchTag('ShadowLogError',
        () => Effect.fail(new HttpError(500, 'Failed to persist shadow recommendation'))));
      sendJson(
        request,
        response,
        recorded ? 201 : 200,
        { eventId: event.eventId, recorded },
        allowedOrigins
      );
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

      const payload = yield* readJsonBody(request);
      if (!isEspnDraftSnapshot(payload)) {
        sendJson(request, response, 400, { error: 'Invalid ESPN draft snapshot' }, allowedOrigins);
        return;
      }
      const espnPayload = payload;
      if (espnPayload.draft.draftId !== route.draftId) {
        sendJson(request, response, 400, { error: 'Invalid ESPN draft snapshot' }, allowedOrigins);
        return;
      }
      // Reject bogus clocks before allocating a session.
      if (Math.abs(espnPayload.observedAt - Date.now()) > 5 * 60_000) {
        return yield* new HttpError(400, 'ESPN observation time must be within five minutes of the server clock');
      }
      const session = yield* attempt(() => getSession(route.provider, route.draftId));
      const snapshot = yield* attempt(() => session.ingest(
        espnPayload.draft,
        espnPayload.picks,
        espnPayload.observedAt
      ));
      sendJson(request, response, 200, snapshot, allowedOrigins);
      return;
    }

    if (route.isStream && request.method === 'GET') {
      const clientCount = [...sessions.values()].reduce((count, session) => count + session.clientCount, 0);
      if (clientCount >= limits.maxClients) return yield* new HttpError(429, 'Too many event streams');
      const session = yield* attempt(() => getSession(route.provider, route.draftId));
      if (session.clientCount >= limits.maxClientsPerSession) return yield* new HttpError(429, 'Too many streams for this draft');
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
      const session = yield* attempt(() => getSession(route.provider, route.draftId));
      const snapshot = yield* session.refresh();
      sendJson(request, response, 200, snapshot, allowedOrigins);
      return;
    }

    if (route.isReset && route.provider === 'espn' && request.method === 'POST') {
      sendJson(request, response, 200, (yield* attempt(() => getSession(route.provider, route.draftId))).reset(), allowedOrigins);
      return;
    }

    if (
      !route.isStream &&
      !route.isRefresh &&
      !route.isSnapshot &&
      !route.isReset &&
      request.method === 'GET'
    ) {
      const session = yield* attempt(() => getSession(route.provider, route.draftId));
      if (session.getSnapshot().status === 'idle') {
        yield* session.refresh();
      }
      sendJson(request, response, 200, session.getSnapshot(), allowedOrigins);
      return;
    }

    sendNotFound(request, response, allowedOrigins);
  });

  function sendFailure(request: IncomingMessage, response: ServerResponse, cause: Cause.Cause<HttpError>): void {
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const error = Cause.squash(cause);
    if (error instanceof HttpError) {
      if (error.status === 429) response.setHeader('Retry-After', '60');
      sendJson(request, response, error.status, { error: error.message }, allowedOrigins);
      return;
    }
    console.error('[sync-server] Request failed', error);
    sendJson(request, response, 500, { error: 'Internal server error' }, allowedOrigins);
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
    void Effect.runPromise(handleRequest(request, response).pipe(
      Effect.catchCause((cause) => Effect.sync(() => { sendFailure(request, response, cause); })),
      Effect.ensuring(Effect.sync(release)),
    ));
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
    draftDataRefresh.dispose();
  };
  server.once('close', disposeSessions);

  const syncServer = server as SyncServer;
  syncServer.shutdown = (callback) => {
    disposeSessions();
    server.close(callback);
  };

  return syncServer;
}
