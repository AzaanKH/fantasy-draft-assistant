import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Stream } from 'effect';
import { isDraftSyncSnapshot, isDraftSyncUpdate, isMarketAdpSnapshot, isDraftSessionSummary, type DraftSessionSummary, type DraftSyncSnapshot, type DraftSyncUpdate, type LeagueSettings, type MarketAdpPlayer } from '@fantasy-draft/shared';
import type { SessionId } from './arguments';
import { CliError } from './errors';

const MAX_EVENT_BYTES = 2 * 1024 * 1024;

export const readPairingToken = Effect.fn('readPairingToken')(function* (root: string, env: NodeJS.ProcessEnv) {
  const token = env.SYNC_REQUEST_TOKEN ?? (yield* Effect.tryPromise({
    try: async () => (await readFile(join(root, '.local/sync-token'), 'utf8')).trim(),
    catch: () => new CliError('PAIRING_REQUIRED', 'Start pnpm dev:live to create .local/sync-token, or export the server\'s SYNC_REQUEST_TOKEN.'),
  }));
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) return yield* new CliError('INVALID_TOKEN', 'The local pairing token is invalid. Restart the local services to pair again.');
  return token;
});

interface SseState { readonly buffer: string; readonly data: readonly string[]; readonly frameSize: number }

/** Consume complete lines from decoded text, returning the draft updates whose frames finished. */
function decodeSseText(state: SseState, text: string): readonly [SseState, readonly DraftSyncUpdate[]] {
  let buffer = state.buffer + text;
  let data = [...state.data];
  let frameSize = state.frameSize;
  if (buffer.length > MAX_EVENT_BYTES) throw new CliError('INVALID_STREAM', 'The draft event exceeds the stream size limit.');
  const events: DraftSyncUpdate[] = [];
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
        events.push(event);
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
  return [{ buffer, data, frameSize }, events];
}

/** Parse SSE incrementally, including frames split across UTF-8 or CRLF boundaries. */
export const parseDraftEvents = (body: ReadableStream<Uint8Array>): Stream.Stream<DraftSyncUpdate, CliError> =>
  Stream.fromReadableStream({
    evaluate: () => body,
    onError: () => new CliError('STREAM_DISCONNECTED', 'The draft event stream disconnected.'),
  }).pipe(
    Stream.decodeText(),
    Stream.mapAccumEffect((): SseState => ({ buffer: '', data: [], frameSize: 0 }), (state, text) => Effect.try({
      try: () => decodeSseText(state, text),
      catch: error => error instanceof CliError ? error : new CliError('INVALID_STREAM', 'The server sent an invalid draft event.'),
    })),
  );

const serverTimeout = (serverUrl: string) => new CliError('SERVER_UNAVAILABLE', `${serverUrl} did not respond in time. Check that the local server is running with pnpm dev:live.`);

export class DraftClient {
  constructor(private readonly serverUrl: string, private readonly token: string) {}

  private route(session: SessionId): string {
    return `/api/sync/${session.provider}/drafts/${encodeURIComponent(session.draftId)}`;
  }

  private request(path: string, method: string): Effect.Effect<Response, CliError> {
    return Effect.tryPromise({
      try: signal => fetch(`${this.serverUrl}${path}`, {
        method, signal, headers: { 'X-Sync-Token': this.token }, redirect: 'error',
      }),
      catch: () => new CliError('SERVER_UNAVAILABLE', `Cannot reach ${this.serverUrl}. Start the local server with pnpm dev:live.`),
    }).pipe(Effect.flatMap(response => {
      if (response.ok) return Effect.succeed(response);
      const error = response.status === 403
        ? new CliError('PAIRING_REJECTED', 'The server rejected the pairing token. Use the same SYNC_REQUEST_TOKEN as the server or its .local/sync-token.')
        : new CliError(response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', `The local server returned HTTP ${String(response.status)}.`);
      return cancelBody(response).pipe(Effect.andThen(Effect.fail(error)));
    }));
  }

  /** Request and parse JSON within one deadline, so a stalled body cannot hang the command. */
  private json(path: string, method: string, timeoutMs: number, invalid: CliError): Effect.Effect<unknown, CliError> {
    return this.request(path, method).pipe(
      Effect.flatMap(response => Effect.tryPromise({ try: () => response.json() as Promise<unknown>, catch: () => invalid })),
      Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.fail(serverTimeout(this.serverUrl)) }),
    );
  }

  snapshot(session: SessionId): Effect.Effect<DraftSyncSnapshot, CliError> {
    return this.json(`${this.route(session)}/refresh`, 'POST', 20_000,
      new CliError('INVALID_SNAPSHOT', 'The server sent an invalid JSON snapshot.')).pipe(Effect.flatMap(value =>
      !isDraftSyncSnapshot(value) || value.provider !== session.provider || value.draftId !== session.draftId ||
        (value.draft && (value.draft.provider !== session.provider || value.draft.draftId !== session.draftId))
        ? Effect.fail(new CliError('INVALID_SNAPSHOT', 'The server snapshot does not match the requested session.'))
        : Effect.succeed(value)));
  }

  sessions(): Effect.Effect<readonly DraftSessionSummary[], CliError> {
    const invalid = new CliError('INVALID_SESSIONS', 'The server sent an invalid session list.');
    return this.json('/api/sync/sessions', 'GET', 20_000, invalid).pipe(Effect.flatMap(value => {
      const sessions = (value as { sessions?: unknown } | null)?.sessions;
      return Array.isArray(sessions) && sessions.length <= 128 && sessions.every(isDraftSessionSummary)
        ? Effect.succeed(sessions) : Effect.fail(invalid);
    }));
  }

  marketAdp(settings: LeagueSettings, season: number): Effect.Effect<{
    players: readonly MarketAdpPlayer[]; warning?: string;
  }, CliError> {
    const reception = settings.scoringRules.receiving.reception;
    const format = reception >= 0.75 ? 'ppr' : reception >= 0.25 ? 'half-ppr' : 'standard';
    const params = new URLSearchParams({ format, teams: String(Math.max(8, Math.min(14, settings.totalTeams))), season: String(season) });
    const invalid = new CliError('INVALID_MARKET_ADP', 'Invalid ADP data');
    return this.json(`/api/market-adp?${params.toString()}`, 'GET', 12_000, invalid).pipe(
      Effect.flatMap(value => isMarketAdpSnapshot(value) ? Effect.succeed({ players: value.players }) : Effect.fail(invalid)),
      // ADP is optional, but a rejected token means every later request will fail too.
      Effect.catchIf(error => error.code !== 'PAIRING_REJECTED', () => Effect.succeed({ players: [],
        warning: 'Fantasy Football Calculator ADP is unavailable. Using the FantasyPros market fallback.' })),
    );
  }

  /** Bound connection establishment and idle gaps; a stream that goes quiet ends so the caller can reconnect. */
  events(session: SessionId): Stream.Stream<DraftSyncUpdate, CliError> {
    return Stream.unwrap(this.request(`${this.route(session)}/events`, 'GET').pipe(
      Effect.timeoutOrElse({ duration: 20_000, orElse: () => Effect.fail(serverTimeout(this.serverUrl)) }),
      Effect.flatMap(response => {
        if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
          return cancelBody(response).pipe(Effect.andThen(Effect.fail(
            new CliError('INVALID_STREAM', 'The server did not return a draft event stream.'))));
        }
        return Effect.succeed(parseDraftEvents(response.body));
      }),
    )).pipe(
      Stream.timeout(30_000),
      Stream.mapEffect(event => {
        const identity = event.type === 'heartbeat' ? event : event.snapshot;
        return identity.provider !== session.provider || identity.draftId !== session.draftId ||
          event.type !== 'heartbeat' && event.snapshot.draft !== null &&
          (event.snapshot.draft.provider !== session.provider || event.snapshot.draft.draftId !== session.draftId)
          ? Effect.fail(new CliError('INVALID_STREAM', 'The event does not match the requested session.'))
          : Effect.succeed(event);
      }),
    );
  }
}

const cancelBody = (response: Response) => Effect.promise(async () => { await response.body?.cancel().catch(() => undefined); });
