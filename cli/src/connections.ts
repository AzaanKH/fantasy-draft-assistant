import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { parseSession, type SessionId } from './arguments';
import { readBoundedJson, writePrivateJson } from './files';
import { CliError } from './errors';

const savedConnection = Schema.StructWithRest(Schema.Struct({
  session: Schema.String.check(Schema.makeFilter(value => {
    try { return parseSession(value).id === value; } catch { return false; }
  })),
  slot: Schema.optional(Schema.Finite.check(Schema.makeFilter(value => Number.isInteger(value) && value >= 1 && value <= 32))),
  serverUrl: Schema.String,
  connectedAt: Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value)))),
}), [Schema.Record(Schema.String, Schema.Unknown)]);
const connectionConfig = Schema.StructWithRest(Schema.Struct({
  schemaVersion: Schema.Literal(1), activeSession: Schema.NullOr(Schema.String),
  connections: Schema.Array(savedConnection).check(Schema.makeFilter(value => value.length <= 128)),
}), [Schema.Record(Schema.String, Schema.Unknown)]).check(Schema.makeFilter(value =>
  value.activeSession === null || value.connections.some(row => row.session === value.activeSession)
));
const decodeConnectionConfig = Schema.decodeUnknownSync(connectionConfig);
type ConnectionConfig = typeof connectionConfig.Type;
export const EMPTY_CONNECTIONS: ConnectionConfig = { schemaVersion: 1, activeSession: null, connections: [] };

export const loadConnections = Effect.fn('loadConnections')(function* (root: string) {
  const invalid = new CliError('INVALID_CONNECTION_CONFIG', 'The saved CLI connections are invalid. Repair or remove .local/cli-connections.json.');
  return yield* readBoundedJson(join(root, '.local/cli-connections.json'), 64 * 1024).pipe(
    Effect.flatMap(value => Effect.try({
      try: () => decodeConnectionConfig(value),
      catch: () => invalid,
    })),
    Effect.catchTag('JsonFileError', error => error.missing ? Effect.succeed(EMPTY_CONNECTIONS) : Effect.fail(invalid)),
    Effect.mapError(() => invalid),
  );
});

export const saveConnection = Effect.fn('saveConnection')(function* (root: string, session: SessionId,
  slot: number | undefined, serverUrl: string, now: number) {
  const config = yield* loadConnections(root);
  const connections = config.connections.filter(row => row.session !== session.id);
  const existing = config.connections.find(row => row.session === session.id);
  connections.push({ session: session.id, slot: slot ?? existing?.slot, serverUrl, connectedAt: new Date(now).toISOString() });
  const path = join(root, '.local/cli-connections.json');
  yield* writePrivateJson(path, { schemaVersion: 1, activeSession: session.id,
    connections: connections.slice(-128) }, true);
  return path;
});
