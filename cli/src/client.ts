import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDraftSyncSnapshot, isDraftSyncUpdate, isMarketAdpSnapshot, isDraftSessionSummary, type DraftSessionSummary, type DraftSyncSnapshot, type DraftSyncUpdate, type LeagueSettings, type MarketAdpPlayer } from '@fantasy-draft/shared';
import type { SessionId } from './arguments';
import { CliError } from './errors';

const MAX_EVENT_BYTES = 2 * 1024 * 1024;

export async function readPairingToken(root: string, env: NodeJS.ProcessEnv): Promise<string> {
  let token = env.SYNC_REQUEST_TOKEN;
  if (token === undefined) {
    try { token = (await readFile(join(root, '.local/sync-token'), 'utf8')).trim(); }
    catch { throw new CliError('PAIRING_REQUIRED', 'Start pnpm dev:live to create .local/sync-token, or export the server\'s SYNC_REQUEST_TOKEN.'); }
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new CliError('INVALID_TOKEN', 'The local pairing token is invalid. Restart the local services to pair again.');
  return token;
}

/** Parse SSE incrementally, including frames split across UTF-8 or CRLF boundaries. */
export async function* parseDraftEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<DraftSyncUpdate> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let frameSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > MAX_EVENT_BYTES) throw new CliError('INVALID_STREAM', 'The draft event exceeds the stream size limit.');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (data.length > 0) {
            let event: unknown;
            try { event = JSON.parse(data.join('\n')); }
            catch { throw new CliError('INVALID_STREAM', 'The server sent an invalid JSON draft event.'); }
            if (!isDraftSyncUpdate(event)) throw new CliError('INVALID_STREAM', 'The server sent an invalid draft update.');
            yield event;
          }
          data = [];
          frameSize = 0;
        } else if (line.startsWith('data:')) {
          const content = line.slice(5).replace(/^ /, '');
          frameSize += content.length;
          if (frameSize > MAX_EVENT_BYTES) throw new CliError('INVALID_STREAM', 'The draft event exceeds the stream size limit.');
          data.push(content);
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class DraftClient {
  constructor(private readonly serverUrl: string, private readonly token: string) {}

  private route(session: SessionId): string {
    return `/api/sync/${session.provider}/drafts/${encodeURIComponent(session.draftId)}`;
  }

  private async request(path: string, method: string, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.serverUrl}${path}`, {
        method, signal, headers: { 'X-Sync-Token': this.token }, redirect: 'error',
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new CliError('SERVER_UNAVAILABLE', `Cannot reach ${this.serverUrl}. Start the local server with pnpm dev:live.`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403) throw new CliError('PAIRING_REJECTED', 'The server rejected the pairing token. Use the same SYNC_REQUEST_TOKEN as the server or its .local/sync-token.');
      throw new CliError(response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', `The local server returned HTTP ${String(response.status)}.`);
    }
    return response;
  }

  async snapshot(session: SessionId, signal: AbortSignal): Promise<DraftSyncSnapshot> {
    const response = await this.request(`${this.route(session)}/refresh`, 'POST',
      AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new CliError('INVALID_SNAPSHOT', 'The server sent an invalid JSON snapshot.'); }
    if (!isDraftSyncSnapshot(value) || value.provider !== session.provider || value.draftId !== session.draftId ||
        (value.draft && (value.draft.provider !== session.provider || value.draft.draftId !== session.draftId))) {
      throw new CliError('INVALID_SNAPSHOT', 'The server snapshot does not match the requested session.');
    }
    return value;
  }

  async sessions(signal: AbortSignal): Promise<readonly DraftSessionSummary[]> {
    const response = await this.request('/api/sync/sessions', 'GET', AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    const value = await response.json() as { sessions?: unknown };
    if (!value || !Array.isArray(value.sessions) || value.sessions.length > 128 || !value.sessions.every(isDraftSessionSummary)) {
      throw new CliError('INVALID_SESSIONS', 'The server sent an invalid session list.');
    }
    return value.sessions;
  }

  async marketAdp(settings: LeagueSettings, season: number, signal: AbortSignal): Promise<{
    players: readonly MarketAdpPlayer[]; warning?: string;
  }> {
    const reception = settings.scoringRules.receiving.reception;
    const format = reception >= 0.75 ? 'ppr' : reception >= 0.25 ? 'half-ppr' : 'standard';
    const params = new URLSearchParams({ format, teams: String(Math.max(8, Math.min(14, settings.totalTeams))), season: String(season) });
    try {
      const response = await this.request(`/api/market-adp?${params.toString()}`, 'GET', AbortSignal.any([signal, AbortSignal.timeout(12_000)]));
      const value: unknown = await response.json();
      if (!isMarketAdpSnapshot(value)) throw new Error('Invalid ADP data');
      return { players: value.players };
    } catch (error) {
      if (signal.aborted || error instanceof CliError && error.code === 'PAIRING_REJECTED') throw error;
      return { players: [], warning: 'Fantasy Football Calculator ADP is unavailable. Using the FantasyPros market fallback.' };
    }
  }

  async *events(session: SessionId, signal: AbortSignal): AsyncGenerator<DraftSyncUpdate> {
    // Bound connection establishment while keeping a healthy stream open indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await this.request(`${this.route(session)}/events`, 'GET', AbortSignal.any([signal, controller.signal]));
    } finally { clearTimeout(timer); }
    if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
      await response.body?.cancel();
      throw new CliError('INVALID_STREAM', 'The server did not return a draft event stream.');
    }
    let idleTimer = setTimeout(() => controller.abort(), 30_000);
    try {
      for await (const event of parseDraftEvents(response.body)) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), 30_000);
        const identity = event.type === 'heartbeat' ? event : event.snapshot;
        if (identity.provider !== session.provider || identity.draftId !== session.draftId ||
            event.type !== 'heartbeat' && event.snapshot.draft !== null &&
            (event.snapshot.draft.provider !== session.provider || event.snapshot.draft.draftId !== session.draftId)) {
          throw new CliError('INVALID_STREAM', 'The event does not match the requested session.');
        }
        yield event;
      }
    } finally { clearTimeout(idleTimer); }
  }
}
