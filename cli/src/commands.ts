export interface CommandDescriptor {
  readonly help: string;
  readonly options: readonly string[];
  readonly replay: boolean;
  readonly positionals: number | 'optional';
  readonly examples: readonly { readonly task: string; readonly command: string; readonly result: string }[];
}

export const COMMANDS = {
  readiness: {
    help: '  readiness                 Check core data, freshness, settings, and keepers',
    options: [], replay: true, positionals: 0,
    examples: [
      {
        task: 'Check readiness',
        command: 'draft readiness --json',
        result: 'Local core blockers, freshness, saved settings, keeper resolution, and optional degradation.',
      },
      {
        task: 'Verify a connected draft',
        command: 'draft readiness --session SESSION --json',
        result: 'Provider settings, keeper confirmation, sync blockers, and `readyForAdvice`.',
      },
    ],
  },
  status: {
    help: '  status --session SESSION  Inspect picks, your next turn, and sync health',
    options: [], replay: true, positionals: 0,
    examples: [
      {
        task: 'Inspect a connected draft',
        command: 'draft status --session SESSION --json',
        result: 'Current pick, on-the-clock slot, your next turn, roster, and sync health.',
      },
    ],
  },
  players: {
    help: '  players --session SESSION Search the player pool with stable IDs',
    options: ['position', 'available', 'search', 'limit'], replay: true, positionals: 0,
    examples: [
      {
        task: 'Search available players',
        command: 'draft players --session SESSION --position WR --available --json',
        result: 'Filtered players with stable canonical `id` values.',
      },
    ],
  },
  recommend: {
    help: '  recommend --session SESSION',
    options: ['lens', 'limit'], replay: true, positionals: 0,
    examples: [
      {
        task: 'Get advice',
        command: 'draft recommend --session SESSION --lens best-pick --limit 5 --json',
        result: 'Ranked candidates, explanations, roster needs, and Best Pick/Best Player divergence.',
      },
    ],
  },
  compare: {
    help: '  compare PLAYER_A PLAYER_B --session SESSION',
    options: ['lens'], replay: true, positionals: 2,
    examples: [
      {
        task: 'Compare alternatives',
        command: 'draft compare PLAYER_A PLAYER_B --session SESSION --json',
        result: 'Quality, roster fit, position tiers, timing, and the preferred alternative.',
      },
    ],
  },
  wait: {
    help: '  wait PLAYER_ID --session SESSION',
    options: [], replay: true, positionals: 1,
    examples: [
      {
        task: 'Ask whether to wait',
        command: 'draft wait PLAYER_ID --session SESSION --json',
        result: 'Return Probability, Expected Next-Pick Alternative, cost of waiting, and explanations.',
      },
    ],
  },
  watch: {
    help: '  watch --session SESSION --format ndjson',
    options: ['format'], replay: false, positionals: 0,
    examples: [
      {
        task: 'Follow the draft',
        command: 'draft watch --session SESSION --format ndjson',
        result: 'An ongoing stream of provider snapshots, picks, sync changes, and heartbeats.',
      },
    ],
  },
  sessions: {
    help: '  sessions                  List sessions retained by the local server',
    options: [], replay: false, positionals: 0,
    examples: [
      {
        task: 'Discover sessions',
        command: 'draft sessions --json',
        result: 'Retained provider sessions, sync state, active connection, and saved slots.',
      },
    ],
  },
  connect: {
    help: '  connect SESSION_OR_URL    Connect and save your session and draft slot',
    options: [], replay: false, positionals: 'optional',
    examples: [
      {
        task: 'Connect a draft',
        command: 'draft connect SESSION_OR_URL --slot 5 --json',
        result: 'Validated connection and saved defaults for later commands.',
      },
    ],
  },
  roster: {
    help: '  roster --session SESSION  Inspect players, keepers, and remaining needs',
    options: [], replay: true, positionals: 0,
    examples: [
      {
        task: 'Inspect your roster',
        command: 'draft roster --session SESSION --json',
        result: 'Player details, confirmed picks, keeper reservations, remaining selections, and roster needs.',
      },
    ],
  },
  export: {
    help: '  export --session SESSION --out FILE\n                            Save a self-contained session archive',
    options: ['out', 'force'], replay: false, positionals: 0,
    examples: [
      {
        task: 'Export a session',
        command: 'draft export --session SESSION --out FILE --json',
        result: 'A portable archive of the snapshot, player pool, model, policy, keepers, and readiness evidence.',
      },
    ],
  },
  replay: {
    help: '  replay FILE [--pick NUMBER] [--format ndjson]\n                            Inspect or stream recorded picks offline',
    options: ['pick', 'format'], replay: false, positionals: 1,
    examples: [
      {
        task: 'Replay a session',
        command: 'draft replay FILE --pick 24 --json',
        result: 'Recorded status, snapshot, readiness, and roster before overall pick 24.',
      },
      {
        task: 'Stream recorded picks',
        command: 'draft replay FILE --format ndjson',
        result: 'A finite sequence of reconstructed snapshots in pick order.',
      },
    ],
  },
} satisfies Record<string, CommandDescriptor>;

export type Command = keyof typeof COMMANDS;

export function isCommand(value: string | undefined): value is Command {
  return value !== undefined && Object.hasOwn(COMMANDS, value);
}
