import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ECRPlayer,
  FantasyProsAdpPlayer,
  FantasyProsSnapshot,
  NFLTeam,
  Position,
} from '@fantasy-draft/shared';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data');
const FANTASYPROS_FILE = join(DATA_DIR, 'fantasypros-snapshot.json');
const SLEEPER_FILE = join(DATA_DIR, 'sleeper-adp.json');
const OUTPUT_FILE = join(DATA_DIR, 'player-identity.json');

interface SleeperPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
}

interface SleeperFile {
  readonly fetchedAt: string;
  readonly players: readonly SleeperPlayer[];
}

type FantasyProsPlayer = ECRPlayer | FantasyProsAdpPlayer;
type MatchMethod = 'exact-name-team' | 'unique-name-position' | 'team-defense' | 'unmatched';

interface IdentityRecord {
  readonly canonicalId: string;
  readonly sleeperId?: string;
  readonly fantasyProsId?: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly position: Position;
  readonly team: NFLTeam;
  readonly matchMethod: MatchMethod;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\.?$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function exactKey(player: { name: string; team: NFLTeam }): string {
  return `${normalizeName(player.name)}|${player.team}`;
}

function namePositionKey(player: { name: string; position: Position }): string {
  return `${normalizeName(player.name)}|${player.position}`;
}

function uniqueNamePositionMap(players: readonly SleeperPlayer[]): Map<string, SleeperPlayer> {
  const result = new Map<string, SleeperPlayer>();
  const duplicates = new Set<string>();
  for (const player of players) {
    const key = namePositionKey(player);
    if (result.has(key)) {
      result.delete(key);
      duplicates.add(key);
    } else if (!duplicates.has(key)) {
      result.set(key, player);
    }
  }
  return result;
}

function dedupeFantasyProsPlayers(snapshot: FantasyProsSnapshot): FantasyProsPlayer[] {
  const byId = new Map<string, FantasyProsPlayer>();
  const withoutId = new Map<string, FantasyProsPlayer>();
  for (const player of [...snapshot.rankings, ...snapshot.adp]) {
    if (player.fantasyProsId) {
      if (!byId.has(player.fantasyProsId)) byId.set(player.fantasyProsId, player);
    } else {
      const key = `${exactKey(player)}|${player.position}`;
      if (!withoutId.has(key)) withoutId.set(key, player);
    }
  }
  return [...byId.values(), ...withoutId.values()];
}

async function main(): Promise<void> {
  const [fantasyProsRaw, sleeperRaw] = await Promise.all([
    readFile(FANTASYPROS_FILE, 'utf8'),
    readFile(SLEEPER_FILE, 'utf8'),
  ]);
  const fantasyPros = JSON.parse(fantasyProsRaw) as FantasyProsSnapshot;
  const sleeper = JSON.parse(sleeperRaw) as SleeperFile;
  const fantasyProsPlayers = dedupeFantasyProsPlayers(fantasyPros);
  const sleeperExact = new Map(sleeper.players.map((player) => [exactKey(player), player]));
  const sleeperNamePosition = uniqueNamePositionMap(sleeper.players);
  const matchedSleeperIds = new Set<string>();
  const records: IdentityRecord[] = [];

  for (const player of fantasyProsPlayers) {
    const defense = player.position === 'DEF'
      ? sleeper.players.find(
          (candidate) => candidate.position === 'DEF' && candidate.team === player.team
        )
      : undefined;
    const sleeperPlayer =
      defense ??
      sleeperExact.get(exactKey(player)) ??
      sleeperNamePosition.get(namePositionKey(player));
    const matchMethod: MatchMethod = defense
      ? 'team-defense'
      : sleeperExact.has(exactKey(player))
        ? 'exact-name-team'
        : sleeperPlayer
          ? 'unique-name-position'
          : 'unmatched';

    if (sleeperPlayer) matchedSleeperIds.add(sleeperPlayer.playerId);
    const canonicalId = sleeperPlayer?.playerId ?? `fantasypros-${player.fantasyProsId ?? exactKey(player)}`;
    records.push({
      canonicalId,
      sleeperId: sleeperPlayer?.playerId,
      fantasyProsId: player.fantasyProsId,
      name: player.name,
      aliases: sleeperPlayer && sleeperPlayer.name !== player.name
        ? [player.name, sleeperPlayer.name]
        : [player.name],
      position: player.position,
      team: sleeperPlayer?.team ?? player.team,
      matchMethod,
    });
  }

  for (const player of sleeper.players) {
    if (matchedSleeperIds.has(player.playerId)) continue;
    records.push({
      canonicalId: player.playerId,
      sleeperId: player.playerId,
      name: player.name,
      aliases: [player.name],
      position: player.position,
      team: player.team,
      matchMethod: 'unmatched',
    });
  }

  const fantasyProsRankingIds = new Set(
    fantasyPros.rankings.map((player: ECRPlayer) => player.fantasyProsId).filter(Boolean)
  );
  const matchedRankings = records.filter(
    (record) =>
      record.sleeperId !== undefined &&
      record.fantasyProsId !== undefined &&
      fantasyProsRankingIds.has(record.fantasyProsId)
  ).length;
  const matchedDefenses = records.filter(
    (record) => record.position === 'DEF' && record.matchMethod === 'team-defense'
  ).length;
  const output = {
    generatedAt: new Date().toISOString(),
    season: fantasyPros.metadata.season,
    sources: {
      fantasyProsRefreshedAt: fantasyPros.metadata.refreshedAt,
      sleeperFetchedAt: sleeper.fetchedAt,
    },
    coverage: {
      fantasyProsRankings: fantasyPros.rankings.length,
      matchedFantasyProsRankings: matchedRankings,
      fantasyProsRankingMatchRate: Number(
        (matchedRankings / Math.max(1, fantasyPros.rankings.length)).toFixed(4)
      ),
      matchedDefenses,
      sleeperPlayers: sleeper.players.length,
      identityRecords: records.length,
    },
    players: records.sort((a, b) =>
      a.position.localeCompare(b.position) || a.name.localeCompare(b.name)
    ),
  };

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(
    `Player identity written: ${String(matchedRankings)}/${String(fantasyPros.rankings.length)} ` +
    `FantasyPros rankings matched; ${String(matchedDefenses)}/32 defenses matched.`
  );
}

main().catch((error: unknown) => {
  console.error('Player identity build failed:', error);
  process.exit(1);
});
