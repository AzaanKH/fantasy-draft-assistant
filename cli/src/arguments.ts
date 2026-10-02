import { parseArgs } from 'node:util';
import { isPosition, type DecisionLens, type DraftProvider, type Position } from '@fantasy-draft/shared';
import { CliError } from './errors';
import { parseDraftRoomUrl } from '../../extension/src/content/draft-url';

export const COMMANDS = ['readiness', 'status', 'players', 'recommend', 'compare', 'wait', 'watch',
  'sessions', 'connect', 'roster', 'export', 'replay'] as const;
export type Command = typeof COMMANDS[number];
export interface SessionId { readonly provider: DraftProvider; readonly draftId: string; readonly id: string }
export interface Arguments {
  readonly command: Command;
  readonly session?: SessionId;
  readonly slot?: number;
  readonly json: boolean;
  readonly position?: Position;
  readonly available: boolean;
  readonly search?: string;
  readonly lens: DecisionLens;
  readonly limit?: number;
  readonly playerIds: readonly string[];
  readonly serverUrl: string;
  readonly outputFile?: string;
  readonly replayFile?: string;
  readonly pick?: number;
  readonly force: boolean;
  readonly format?: 'ndjson';
}

export interface ArgumentDefaults {
  readonly session?: string;
  readonly connections?: readonly { session: string; slot?: number; serverUrl: string }[];
}

export const HELP = `Usage: draft COMMAND [options]

Commands:
  readiness                 Check core data, freshness, settings, and keepers
  status --session SESSION  Inspect picks, your next turn, and sync health
  players --session SESSION Search the player pool with stable IDs
  recommend --session SESSION
  compare PLAYER_A PLAYER_B --session SESSION
  wait PLAYER_ID --session SESSION
  watch --session SESSION --format ndjson
  sessions                  List sessions retained by the local server
  connect SESSION_OR_URL    Connect and save your session and draft slot
  roster --session SESSION  Inspect players, keepers, and remaining needs
  export --session SESSION --out FILE
                            Save a self-contained session archive
  replay FILE [--pick NUMBER] [--format ndjson]
                            Inspect or stream recorded picks offline

Options:
  --json                    Write a versioned JSON result, including errors
  --session SESSION         provider:draftId, or a bare Sleeper draft ID
  --slot NUMBER             Your one-based draft slot, also DRAFT_SLOT
  --position QB|RB|WR|TE|K|DEF
  --available               Exclude drafted players and keeper reservations
  --search TEXT             Search player names, teams, and stable IDs
  --lens best-pick|best-player
  --limit NUMBER            Result count, defaults to 5 for recommend
  --server-url URL          Local server, also DRAFT_SERVER_URL
  --out FILE                Export path, existing files require --force
  --force                   Replace an existing export file
  --replay FILE             Run status, roster, players, or advice offline
  --pick NUMBER             Inspect the archive before this overall pick
  --help                    Show this help

SESSION defaults to DRAFT_SESSION, then the last saved connection. The server defaults to
http://127.0.0.1:3001. Pairing uses SYNC_REQUEST_TOKEN or .local/sync-token.
Use readiness --session SESSION to check connected provider settings.
Advice requires --slot, DRAFT_SLOT, or a saved slot. Player IDs come from players output.
Exit codes: 0 success, 1 operational error, 2 usage error, 3 readiness blocked.
`;

function usage(message: string): never { throw new CliError('INVALID_ARGUMENT', message, 2); }
function integer(value: string | undefined, option: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    return usage(`${option} must be an integer between 1 and ${String(max)}.`);
  }
  return Number(value);
}

export function parseSession(value: string): SessionId {
  const separator = value.indexOf(':');
  const provider = separator < 0 ? 'sleeper' : value.slice(0, separator);
  const draftId = separator < 0 ? value : value.slice(separator + 1);
  if (!['sleeper', 'yahoo', 'espn'].includes(provider) ||
      !(provider === 'sleeper' ? /^[A-Za-z0-9_-]{1,128}$/ : /^\d{1,20}$/).test(draftId)) {
    return usage('SESSION must be sleeper:DRAFT_ID, yahoo:DRAFT_ID, espn:DRAFT_ID, or a bare Sleeper draft ID.');
  }
  return { provider: provider as DraftProvider, draftId, id: `${provider}:${draftId}` };
}

function parseOptions(argv: readonly string[]) {
  const parse = () => parseArgs({ args: [...argv], allowPositionals: true, options: {
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    session: { type: 'string' }, slot: { type: 'string' }, position: { type: 'string' },
    available: { type: 'boolean' }, search: { type: 'string' }, lens: { type: 'string' },
    limit: { type: 'string' }, format: { type: 'string' }, 'server-url': { type: 'string' },
    out: { type: 'string' }, force: { type: 'boolean' }, replay: { type: 'string' }, pick: { type: 'string' },
  } });
  let parsed: ReturnType<typeof parse>;
  try { parsed = parse(); }
  catch (error) { return usage(error instanceof Error ? error.message : 'Invalid arguments.'); }
  return parsed;
}

export function invocationMode(argv: readonly string[]): 'help' | 'replay' | 'live' {
  const parsed = parseOptions(argv);
  if (parsed.values.help || argv.length === 0) return 'help';
  return parsed.positionals[0] === 'replay' || parsed.values.replay !== undefined ? 'replay' : 'live';
}

export function parseArguments(argv: readonly string[], env: NodeJS.ProcessEnv, defaults: ArgumentDefaults = {}): Arguments | null {
  const parsed = parseOptions(argv);
  if (parsed.values.help || argv.length === 0) return null;
  const [command, ...positionals] = parsed.positionals;
  if (!COMMANDS.includes(command as Command)) return usage(`Unknown command ${command ?? ''}. Run draft --help.`);
  const typedCommand = command as Command;
  const values = parsed.values;
  const allowed: Record<Command, readonly string[]> = {
    readiness: [], status: [], players: ['position', 'available', 'search', 'limit'],
    recommend: ['lens', 'limit'], compare: ['lens'], wait: [], watch: ['format'],
    sessions: [], connect: [], roster: [], export: ['out', 'force'], replay: ['pick', 'format'],
  };
  const supportsReplay = ['readiness', 'status', 'players', 'recommend', 'compare', 'wait', 'roster'].includes(typedCommand);
  for (const key of Object.keys(values)) {
    if (!['json', 'help', 'session', 'slot', 'server-url'].includes(key) && !allowed[typedCommand].includes(key) &&
        !(supportsReplay && ['replay', 'pick'].includes(key))) {
      return usage(`--${key} is not supported by ${typedCommand}.`);
    }
  }
  const expectedIds = typedCommand === 'compare' ? 2 : ['wait', 'replay'].includes(typedCommand) ? 1 : 0;
  if (typedCommand === 'connect' ? positionals.length > 1 : positionals.length !== expectedIds) {
    return usage(`${typedCommand} expects ${typedCommand === 'connect' ? 'one session or URL' : String(expectedIds) + ' arguments'}.`);
  }
  const playerIds = ['compare', 'wait'].includes(typedCommand) ? positionals : [];
  if (typedCommand === 'compare' && playerIds[0] === playerIds[1]) return usage('compare expects two different player IDs.');
  if (typedCommand === 'connect' && positionals[0] && values.session) return usage('Pass a connection target or --session, not both.');
  const replayFile = typedCommand === 'replay' ? positionals[0] : values.replay;
  if (replayFile !== undefined && replayFile.trim().length === 0) return usage('Provide a session archive file path.');
  if (replayFile && (values.session || values['server-url'])) return usage('--replay cannot be combined with --session or --server-url.');
  if (values.pick && !replayFile) return usage('--pick requires an offline replay file.');
  if (typedCommand === 'sessions' && (values.session || values.slot)) return usage('sessions lists all retained drafts; use status for a specific session or slot.');
  if (typedCommand === 'export' && !values.out) return usage('export requires --out FILE.');
  if (typedCommand === 'replay' && values.session) return usage('replay reads the session from its archive.');
  const sessionValue = typedCommand === 'sessions' || replayFile ? undefined :
    typedCommand === 'connect' && positionals[0] ? parseConnectTarget(positionals[0]).id :
    values.session ?? env.DRAFT_SESSION ?? defaults.session;
  if (!['readiness', 'sessions', 'replay'].includes(typedCommand) && !sessionValue && !replayFile) {
    return usage('--session SESSION, DRAFT_SESSION, or a saved connection is required.');
  }
  const session = sessionValue ? parseSession(sessionValue) : undefined;
  const saved = defaults.connections?.find(row => row.session ===
    (session?.id ?? (typedCommand === 'sessions' ? defaults.session : undefined)));
  if (values.lens && !['best-pick', 'best-player'].includes(values.lens)) return usage('--lens must be best-pick or best-player.');
  const position = values.position?.toUpperCase();
  if (position !== undefined && !isPosition(position)) return usage('--position must be QB, RB, WR, TE, K, or DEF.');
  if (values.format && values.format !== 'ndjson') return usage('--format must be ndjson.');
  if ((typedCommand === 'watch' || values.format === 'ndjson') && values.json) return usage('Use --format ndjson for streaming output.');
  const serverUrl = replayFile ? 'http://127.0.0.1:3001' : values['server-url'] ?? env.DRAFT_SERVER_URL ?? saved?.serverUrl ?? 'http://127.0.0.1:3001';
  let url: URL;
  try { url = new URL(serverUrl); } catch { return usage('--server-url must be a loopback HTTP URL.'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return usage('--server-url must be a loopback HTTP URL without credentials, a path, or query parameters.');
  }
  return {
    command: typedCommand, session,
    slot: integer(values.slot ?? env.DRAFT_SLOT ?? (saved?.slot === undefined ? undefined : String(saved.slot)), '--slot', 32), json: values.json ?? false,
    position: position, available: values.available ?? false,
    search: values.search, lens: (values.lens ?? 'best-pick') as DecisionLens,
    limit: integer(values.limit, '--limit', 1280), playerIds, serverUrl: url.origin,
    outputFile: values.out, replayFile, pick: integer(values.pick, '--pick', 1281), force: values.force ?? false,
    format: values.format as 'ndjson' | undefined,
  };
}

export function parseConnectTarget(value: string): SessionId {
  if (!value.includes('://')) return parseSession(value);
  let url: URL;
  try { url = new URL(value); } catch { return usage('The provider draft URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return usage('Use a provider draft URL without embedded credentials.');
  const parsed = parseDraftRoomUrl(value);
  if (!parsed.provider || !parsed.draftId) return usage('Use a supported Sleeper, Yahoo, or ESPN draft URL, or provider:DRAFT_ID.');
  return parseSession(`${parsed.provider}:${parsed.draftId}`);
}
