/**
 * Fetches player data from the Sleeper API including its search-rank proxy.
 * This is a Sleeper platform signal, not a true draft-derived ADP feed.
 *
 * API Docs: https://docs.sleeper.com/
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { fetchJson, io, isEntryPoint, runMain } from './effect-runtime.js';
import {
  type NFLTeam,
  type Position,
  isPosition,
  isNFLTeam,
} from '@fantasy-draft/shared/league';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const OUTPUT_FILE = join(DATA_DIR, 'sleeper-adp.json');

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

const sleeperPlayerSchema = Schema.StructWithRest(Schema.Struct({
  player_id: Schema.optional(Schema.String), first_name: Schema.optional(Schema.NullOr(Schema.String)),
  last_name: Schema.optional(Schema.NullOr(Schema.String)), full_name: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.optional(Schema.NullOr(Schema.String)), team: Schema.optional(Schema.NullOr(Schema.String)),
  age: Schema.optional(Schema.NullOr(Schema.Finite)), years_exp: Schema.optional(Schema.NullOr(Schema.Finite)),
  search_rank: Schema.optional(Schema.NullOr(Schema.Finite)), status: Schema.optional(Schema.NullOr(Schema.String)),
  injury_status: Schema.optional(Schema.NullOr(Schema.String)), depth_chart_order: Schema.optional(Schema.NullOr(Schema.Finite)),
  fantasy_positions: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
}), [Schema.Record(Schema.String, Schema.Unknown)]);
const decodeSleeperPlayers = Schema.decodeUnknownSync(Schema.Record(Schema.String, sleeperPlayerSchema));
type SleeperPlayers = ReturnType<typeof decodeSleeperPlayers>;

interface SleeperADPPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly sleeperAdp: number;
  readonly age: number | null;
  readonly yearsExp: number | null;
  readonly status: string;
  readonly injuryStatus: string | null;
  readonly depthChartOrder: number | null;
}

function isValidPosition(value: string): value is Position {
  return isPosition(value);
}

function normalizeSleeperPosition(value: string): Position | null {
  // FantasyPros and the rest of the application treat fullbacks as running
  // backs. Sleeper exposes them as FB, which otherwise drops ranked players
  // such as Kyle Juszczyk and Hunter Luepke from the identity directory.
  if (value === 'FB') return 'RB';
  return isValidPosition(value) ? value : null;
}

function isExcludedSleeperStatus(status: string): boolean {
  // Sleeper also uses "Inactive" for current, team-assigned players during the
  // offseason. Keep those directory entries so fresh FantasyPros rankings can
  // still resolve them; explicit retired/reserve records remain excluded.
  return status === 'Reserve/Retired';
}

function isValidTeam(value: string | null): value is NFLTeam {
  return isNFLTeam(value);
}

// The full player catalog is several megabytes, so allow a slow but bounded download.
export const fetchSleeperPlayers = Effect.sync(() => { console.log(`Fetching from ${SLEEPER_PLAYERS_URL}...`); }).pipe(
  Effect.andThen(fetchJson(SLEEPER_PLAYERS_URL, decodeSleeperPlayers, { label: 'Sleeper API', timeoutMs: 60_000 }, cause => cause instanceof Error ? cause : new Error(String(cause)))),
  Effect.tap((data) => Effect.sync(() => { console.log(`Received ${Object.keys(data).length} total player records`); })),
);

function processSleeperData(rawData: SleeperPlayers): SleeperADPPlayer[] {
  const players: SleeperADPPlayer[] = [];
  const errors: string[] = [];

  for (const [playerId, player] of Object.entries(rawData)) {
    const position = normalizeSleeperPosition(player.position ?? '');
    if (!position) continue;

    const isTeamDefense = position === 'DEF' && isValidTeam(playerId);
    const canonicalTeam = isTeamDefense ? playerId : player.team;

    // Skip players without a team (free agents, retired, etc.). Sleeper team
    // defenses are keyed by their team abbreviation and do not carry `team`.
    if (!canonicalTeam) continue;

    // Keep defenses for identity/sync even when Sleeper supplies no search rank.
    if (
      !isTeamDefense &&
      (player.search_rank === null || player.search_rank === undefined)
    ) continue;

    if (!isValidTeam(canonicalTeam)) {
      errors.push(`Invalid team: ${canonicalTeam} for ${player.full_name}`);
      continue;
    }

    if (isExcludedSleeperStatus(player.status ?? '')) continue;

    players.push({
      playerId,
      name: player.full_name || `${canonicalTeam} Defense`,
      position,
      team: canonicalTeam,
      sleeperAdp: player.search_rank ?? 999,
      age: player.age ?? null,
      yearsExp: player.years_exp ?? null,
      status: player.status ?? '',
      injuryStatus: player.injury_status ?? null,
      depthChartOrder: player.depth_chart_order ?? null,
    });
  }

  if (errors.length > 0) {
    console.warn(`\nProcessing warnings (${errors.length}):`);
    errors.slice(0, 10).forEach((e) => { console.warn(`  - ${e}`); });
    if (errors.length > 10) {
      console.warn(`  ... and ${errors.length - 10} more`);
    }
  }

  players.sort((a, b) => a.sleeperAdp - b.sleeperAdp);

  return players;
}

const program = Effect.gen(function* () {
  console.log('='.repeat(50));
  console.log('Sleeper ADP Fetcher');
  console.log('='.repeat(50));

  const rawData = yield* fetchSleeperPlayers;

  const players = processSleeperData(rawData);
  console.log(`\nProcessed ${players.length} fantasy-relevant players`);

  yield* io(() => mkdir(DATA_DIR, { recursive: true }));

  const output = {
    fetchedAt: new Date().toISOString(),
    source: SLEEPER_PLAYERS_URL,
    signalType: 'search_rank_proxy',
    caveat: 'Sleeper search_rank is a platform ordering proxy, not observed draft ADP.',
    playerCount: players.length,
    players,
  };

  yield* io(() => writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2)));
  console.log(`\nData written to ${OUTPUT_FILE}`);

  const positionCounts = players.reduce<Record<string, number>>(
    (acc, p) => {
      acc[p.position] = (acc[p.position] ?? 0) + 1;
      return acc;
    },
    {}
  );

  console.log('\nPosition breakdown:');
  const entries = Object.entries(positionCounts);
  entries.sort((a, b) => b[1] - a[1]);
  for (const entry of entries) {
    console.log(`  ${entry[0]}: ${entry[1]}`);
  }

  console.log('\nTop 20 by Sleeper ADP:');
  players.slice(0, 20).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name} (${p.team}) - ${p.position} - ADP: ${p.sleeperAdp}`);
  });
});

export const sleeperDataInternals = {
  normalizeSleeperPosition,
  isExcludedSleeperStatus,
};

if (isEntryPoint(import.meta.url)) {
  runMain(program, 'Fetching failed:');
}
