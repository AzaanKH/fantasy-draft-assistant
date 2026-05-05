import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  DraftSyncEngine,
  type DraftSyncSnapshot,
  type DraftSyncUpdate,
  type SleeperDraftMetadata,
  type SleeperDraftPick,
} from '@fantasy-draft/shared';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);
const POLL_INTERVAL_MS = Number.parseInt(process.env.SLEEPER_POLL_INTERVAL_MS ?? '3000', 10);
const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

interface ClientConnection {
  readonly id: number;
  readonly response: ServerResponse<IncomingMessage>;
}

class DraftSession {
  private readonly draftId: string;
  private readonly engine: DraftSyncEngine;
  private readonly clients = new Map<number, ClientConnection>();
  private nextClientId = 1;
  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling = false;

  public constructor(draftId: string) {
    this.draftId = draftId;
    this.engine = new DraftSyncEngine(draftId);
  }

  public getSnapshot(): DraftSyncSnapshot {
    return this.engine.getSnapshot();
  }

  public addClient(response: ServerResponse<IncomingMessage>): number {
    const id = this.nextClientId++;
    this.clients.set(id, { id, response });
    this.ensurePolling();
    this.send({
      type: 'snapshot',
      snapshot: this.engine.getSnapshot(),
    }, response);
    return id;
  }

  public removeClient(id: number): void {
    this.clients.delete(id);
  }

  public async refresh(): Promise<DraftSyncSnapshot> {
    await this.pollOnce();
    return this.engine.getSnapshot();
  }

  private ensurePolling(): void {
    if (this.pollTimer !== null) {
      return;
    }

    void this.pollOnce();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
  }

  private async pollOnce(): Promise<void> {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    this.broadcast({
      type: 'status',
      snapshot: this.engine.beginSync(),
    });

    try {
      const [draft, picks] = await Promise.all([
        fetchJson<SleeperDraftMetadata>(`${SLEEPER_API_BASE}/draft/${this.draftId}`),
        fetchJson<SleeperDraftPick[]>(`${SLEEPER_API_BASE}/draft/${this.draftId}/picks`),
      ]);

      const { snapshot, newPicks } = this.engine.reconcile(draft, picks);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.broadcast({
        type: 'status',
        snapshot: this.engine.failSync(message),
      });
    } finally {
      this.isPolling = false;
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

const sessions = new Map<string, DraftSession>();

function getSession(draftId: string): DraftSession {
  let session = sessions.get(draftId);
  if (!session) {
    session = new DraftSession(draftId);
    sessions.set(draftId, session);
  }

  return session;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Sleeper request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function setCorsHeaders(response: ServerResponse<IncomingMessage>): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown
): void {
  setCorsHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function sendNotFound(response: ServerResponse<IncomingMessage>): void {
  sendJson(response, 404, { error: 'Not found' });
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

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) {
    sendNotFound(response);
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    setCorsHeaders(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  const route = parseDraftRoute(url.pathname);
  if (!route) {
    sendNotFound(response);
    return;
  }

  const session = getSession(route.draftId);

  if (route.isStream && request.method === 'GET') {
    setCorsHeaders(response);
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
    sendJson(response, 200, snapshot);
    return;
  }

  if (!route.isStream && !route.isRefresh && request.method === 'GET') {
    const snapshot = session.getSnapshot();
    if (snapshot.status === 'idle') {
      await session.refresh();
    }
    sendJson(response, 200, session.getSnapshot());
    return;
  }

  sendNotFound(response);
});

server.listen(PORT, () => {
  console.log(`[sync-server] Listening on http://localhost:${PORT}`);
});
