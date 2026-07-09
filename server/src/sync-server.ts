import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  DraftSyncEngine,
  isSleeperDraftMetadata,
  isSleeperDraftPickList,
  type DraftSyncSnapshot,
  type DraftSyncUpdate,
  type SleeperDraftMetadata,
  type SleeperDraftPick,
} from '@fantasy-draft/shared';

export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

export type FetchJson = <T>(url: string) => Promise<T>;

interface ClientConnection {
  readonly id: number;
  readonly response: ServerResponse<IncomingMessage>;
}

interface SyncServerOptions {
  readonly pollIntervalMs?: number;
  readonly fetchJson?: FetchJson;
  readonly allowedOrigins?: readonly string[];
}

class DraftSession {
  private readonly draftId: string;
  private readonly engine: DraftSyncEngine;
  private readonly clients = new Map<number, ClientConnection>();
  private readonly pollIntervalMs: number;
  private readonly fetchJson: FetchJson;
  private nextClientId = 1;
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInFlight: Promise<boolean> | null = null;
  private consecutiveFailures = 0;

  public constructor(
    draftId: string,
    fetchJson: FetchJson,
    pollIntervalMs: number
  ) {
    this.draftId = draftId;
    this.engine = new DraftSyncEngine(draftId);
    this.fetchJson = fetchJson;
    this.pollIntervalMs = pollIntervalMs;
  }

  public getSnapshot(): DraftSyncSnapshot {
    return this.engine.getSnapshot();
  }

  public addClient(response: ServerResponse<IncomingMessage>): number {
    const id = this.nextClientId++;
    this.clients.set(id, { id, response });
    this.ensurePolling();
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
    }
  }

  public dispose(): void {
    this.stopPolling();
    this.clients.clear();
  }

  public async refresh(): Promise<DraftSyncSnapshot> {
    await this.pollOnce();
    return this.engine.getSnapshot();
  }

  private ensurePolling(): void {
    if (this.pollTimer !== null) {
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
    if (this.clients.size === 0 || this.pollTimer !== null) {
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
    this.broadcast({
      type: 'status',
      snapshot: this.engine.beginSync(),
    });

    try {
      const [draftResponse, picksResponse] = await Promise.all([
        this.fetchJson<SleeperDraftMetadata>(`${SLEEPER_API_BASE}/draft/${this.draftId}`),
        this.fetchJson<SleeperDraftPick[]>(`${SLEEPER_API_BASE}/draft/${this.draftId}/picks`),
      ]);
      if (!isSleeperDraftMetadata(draftResponse) || !isSleeperDraftPickList(picksResponse)) {
        throw new Error('Sleeper returned an invalid draft payload');
      }

      const { snapshot, newPicks } = this.engine.reconcile(draftResponse, picksResponse);

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
  const allowedOrigin = origin && (
    allowedOrigins.includes(origin) || origin.startsWith('chrome-extension://')
  )
    ? origin
    : (allowedOrigins[0] ?? 'http://localhost:3000');
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

function parseDraftRoute(pathname: string): { draftId: string; isStream: boolean; isRefresh: boolean } | null {
  const match = pathname.match(/^\/api\/sync\/drafts\/([^/]+)(?:\/(events|refresh))?$/);
  if (!match?.[1]) {
    return null;
  }

  return {
    draftId: decodeURIComponent(match[1]),
    isStream: match[2] === 'events',
    isRefresh: match[2] === 'refresh',
  };
}

export async function defaultFetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Sleeper request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function createSyncServer(options: SyncServerOptions = {}) {
  const sessions = new Map<string, DraftSession>();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const allowedOrigins = options.allowedOrigins?.length
    ? options.allowedOrigins
    : ['http://localhost:3000'];

  function getSession(draftId: string): DraftSession {
    let session = sessions.get(draftId);
    if (!session) {
      session = new DraftSession(draftId, fetchJson, pollIntervalMs);
      sessions.set(draftId, session);
    }

    return session;
  }

  const server = createServer(async (request, response) => {
    if (!request.url || !request.method) {
      sendNotFound(request, response, allowedOrigins);
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'OPTIONS') {
      setCorsHeaders(request, response, allowedOrigins);
      response.statusCode = 204;
      response.end();
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(request, response, 200, { ok: true }, allowedOrigins);
      return;
    }

    const route = parseDraftRoute(url.pathname);
    if (!route) {
      sendNotFound(request, response, allowedOrigins);
      return;
    }

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(route.draftId)) {
      sendJson(request, response, 400, { error: 'Invalid draft ID' }, allowedOrigins);
      return;
    }

    const session = getSession(route.draftId);

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

    if (!route.isStream && !route.isRefresh && request.method === 'GET') {
      const snapshot = session.getSnapshot();
      if (snapshot.status === 'idle') {
        await session.refresh();
      }
      sendJson(request, response, 200, session.getSnapshot(), allowedOrigins);
      return;
    }

    sendNotFound(request, response, allowedOrigins);
  });

  server.on('close', () => {
    for (const session of sessions.values()) {
      session.dispose();
    }
    sessions.clear();
  });

  return server;
}
