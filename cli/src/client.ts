import { http, HttpError } from '@fantasy-draft/shared/http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Stream } from 'effect';
import { decodeDraftSyncSnapshot, decodeDraftSyncUpdate, decodeDraftSessionList, decodeMarketAdpSnapshot, type MarketAdpPlayer } from '@fantasy-draft/shared/catalog';
import { type DraftSessionSummary, type DraftSyncSnapshot, type DraftSyncUpdate } from '@fantasy-draft/shared/sync';
import { type LeagueSettings } from '@fantasy-draft/shared/league';
import type { SessionId } from './arguments';
import { CliError, unexpected } from './errors';

const MAX_EVENT_BYTES = 2 * 1024 * 1024;

export const readPairingToken = Effect.fn('readPairingToken')(function* (root: string, env: NodeJS.ProcessEnv) {
  const token = env.SYNC_REQUEST_TOKEN ?? (yield* Effect.tryPromise({
    try: async () => (await readFile(join(root, '.local/sync-token'), 'utf8')).trim(),
    catch: () => new CliError('PAIRING_REQUIRED', 'Start pnpm dev:live to create .local/sync-token, or export the server\'s SYNC_REQUEST_TOKEN.'),
  }));
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) return yield* new CliError('INVALID_TOKEN', 'The local pairing token is invalid. Restart the local services to pair again.');
  return token;
});

const asCliError = (error: unknown): CliError => error instanceof CliError ? error : unexpected(error);

const serverTimeout = (serverUrl: string) => new CliError('SERVER_UNAVAILABLE', `${serverUrl} did not respond in time. Check that the local server is running with pnpm dev:live.`);

/** Deadlines for whole request/response exchanges; tests shorten them. */
interface DraftClientTimeouts {
  readonly requestMs: number;
  readonly marketAdpMs: number;
  readonly connectMs: number;
  readonly idleMs: number;
}

const DEFAULT_TIMEOUTS: DraftClientTimeouts = { requestMs: 20_000, marketAdpMs: 12_000, connectMs: 20_000, idleMs: 30_000 };

export class DraftClient {
  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
    private readonly timeouts: DraftClientTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  private route(session: SessionId): string {
    return `/api/sync/${session.provider}/drafts/${encodeURIComponent(session.draftId)}`;
  }

  private requestError(error: unknown, invalid: CliError): CliError {
    if (!(error instanceof HttpError)) return asCliError(error);
    if (error.kind === 'invalid-json') return invalid;
    if (error.kind === 'timeout') return serverTimeout(this.serverUrl);
    if (error.kind === 'status') return error.status === 403
      ? new CliError('PAIRING_REJECTED', 'The server rejected the pairing token. Use the same SYNC_REQUEST_TOKEN as the server or its .local/sync-token.')
      : new CliError(error.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', `The local server returned HTTP ${String(error.status)}.`);
    return new CliError('SERVER_UNAVAILABLE', `Cannot reach ${this.serverUrl}. Start the local server with pnpm dev:live.`);
  }

  private json<T>(path: string, method: string, timeoutMs: number, invalid: CliError, decode: (value: unknown) => T): Effect.Effect<T, CliError> {
    return Effect.tryPromise({
      try: signal => http.json(`${this.serverUrl}${path}`, decode,
        { timeoutMs, retries: 0, retryAfter: true },
        { init: { method, signal, headers: { 'X-Sync-Token': this.token }, redirect: 'error' } }),
      catch: error => this.requestError(error, invalid),
    });
  }

  snapshot(session: SessionId): Effect.Effect<DraftSyncSnapshot, CliError> {
    return this.json(`${this.route(session)}/refresh`, 'POST', this.timeouts.requestMs,
      new CliError('INVALID_SNAPSHOT', 'The server sent an invalid JSON snapshot.'), value => {
        try {
          const snapshot = decodeDraftSyncSnapshot(value);
          if (snapshot.provider !== session.provider || snapshot.draftId !== session.draftId) throw new Error('Session mismatch');
          return snapshot;
        } catch {
          console.warn('[draft-client] Rejected invalid draft snapshot');
          throw new CliError('INVALID_SNAPSHOT', 'The server snapshot does not match the requested session.');
        }
      });
  }

  sessions(): Effect.Effect<readonly DraftSessionSummary[], CliError> {
    const invalid = new CliError('INVALID_SESSIONS', 'The server sent an invalid session list.');
    return this.json('/api/sync/sessions', 'GET', this.timeouts.requestMs, invalid, value => {
      try { return decodeDraftSessionList(value).sessions; }
      catch { console.warn('[draft-client] Rejected invalid session list'); throw invalid; }
    });
  }

  marketAdp(settings: LeagueSettings, season: number): Effect.Effect<{
    players: readonly MarketAdpPlayer[]; warning?: string;
  }, CliError> {
    const reception = settings.scoringRules.receiving.reception;
    const format = reception >= 0.75 ? 'ppr' : reception >= 0.25 ? 'half-ppr' : 'standard';
    const params = new URLSearchParams({ format, teams: String(Math.max(8, Math.min(14, settings.totalTeams))), season: String(season) });
    const invalid = new CliError('INVALID_MARKET_ADP', 'Invalid ADP data');
    return this.json(`/api/market-adp?${params.toString()}`, 'GET', this.timeouts.marketAdpMs, invalid, value => {
      try {
        const warnings: string[] = [];
        const snapshot = decodeMarketAdpSnapshot(value, { onWarning: message => warnings.push(message) });
        warnings.unshift(...(snapshot.warnings ?? []));
        return { players: snapshot.players, ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
      } catch { throw invalid; }
    }).pipe(
      // ADP is optional, but a rejected token means every later request will fail too.
      Effect.catchIf(error => error.code !== 'PAIRING_REJECTED', () => Effect.succeed({ players: [],
        warning: 'Fantasy Football Calculator ADP is unavailable. Using the FantasyPros market fallback.' })),
    );
  }

  events(session: SessionId): Stream.Stream<DraftSyncUpdate, CliError> {
    return Stream.fromReadableStream({
      evaluate: () => {
        const controller = new AbortController();
        const iterator = http.events(`${this.serverUrl}${this.route(session)}/events`, value => {
          let event: DraftSyncUpdate;
          try { event = decodeDraftSyncUpdate(value); }
          catch { console.warn('[draft-client] Rejected invalid draft update'); throw new CliError('INVALID_STREAM', 'The server sent an invalid draft update.'); }
          const identity = event.type === 'heartbeat' ? event : event.snapshot;
          if (identity.provider !== session.provider || identity.draftId !== session.draftId ||
              event.type !== 'heartbeat' && event.snapshot.draft !== null &&
              (event.snapshot.draft.provider !== session.provider || event.snapshot.draft.draftId !== session.draftId)) {
            console.warn('[draft-client] Rejected draft event for another session');
            throw new CliError('INVALID_STREAM', 'The event does not match the requested session.');
          }
          return event;
        }, { timeoutMs: this.timeouts.connectMs, idleMs: this.timeouts.idleMs, maxEventBytes: MAX_EVENT_BYTES,
          idleTimeout: 'end', retries: 0, retryAfter: true },
        { init: { headers: { 'X-Sync-Token': this.token }, redirect: 'error', signal: controller.signal } });
        return new ReadableStream<DraftSyncUpdate>({
          async pull(stream) {
            try {
              const next = await iterator.next();
              if (next.done) stream.close();
              else stream.enqueue(next.value);
            } catch (cause) { stream.error(cause); }
          },
          async cancel() { controller.abort(); await iterator.return(undefined); },
        });
      },
      onError: error => error instanceof HttpError && (error.kind === 'invalid-stream' || error.kind === 'invalid-json')
        ? new CliError('INVALID_STREAM', 'The server sent an invalid draft event stream.')
        : this.requestError(error, new CliError('INVALID_STREAM', 'The server sent an invalid draft event.')),
    });
  }
}
