/**
 * Sleeper ADP Fetcher
 *
 * Fetches player data from the Sleeper API including their ADP rankings.
 * Sleeper uses 'search_rank' as their ADP proxy.
 *
 * API Docs: https://docs.sleeper.com/
 * Usage: pnpm fetch:sleeper
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type NFLTeam,
  type Position,
  POSITIONS,
  NFL_TEAMS,
} from '@fantasy-draft/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const OUTPUT_FILE = join(DATA_DIR, 'sleeper-adp.json');

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

/**
 * Raw player data from Sleeper API
 */
interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string;
  team: string | null;
  age: number | null;
  years_exp: number | null;
  search_rank: number | null;
  status: string;
  injury_status: string | null;
  depth_chart_order: number | null;
  fantasy_positions: string[] | null;
}

/**
 * Processed Sleeper ADP data
 */
export interface SleeperADPPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly sleeperAdp: number;
  readonly age: number | null;
  readonly yearsExp: number | null;
  readonly status: string;
}

/**
 * Validates that a string is a valid Position
 */
function isValidPosition(value: string): value is Position {
  return POSITIONS.includes(value as Position);
}

/**
 * Validates that a string is a valid NFLTeam
 */
function isValidTeam(value: string | null): value is NFLTeam {
  return value !== null && NFL_TEAMS.includes(value as NFLTeam);
}

/**
 * Fetch all players from Sleeper API
 */
async function fetchSleeperPlayers(): Promise<Record<string, SleeperPlayer>> {
  console.log(`Fetching from ${SLEEPER_PLAYERS_URL}...`);

  const response = await fetch(SLEEPER_PLAYERS_URL);

  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, SleeperPlayer>;
  console.log(`Received ${Object.keys(data).length} total player records`);

  return data;
}

/**
 * Filter and process players for fantasy relevance
 */
function processSleeperData(rawData: Record<string, SleeperPlayer>): SleeperADPPlayer[] {
  const players: SleeperADPPlayer[] = [];
  const errors: string[] = [];

  for (const [playerId, player] of Object.entries(rawData)) {
    // Skip players without a team (free agents, retired, etc.)
    if (!player.team) continue;

    // Skip players without search_rank (no ADP data)
    if (player.search_rank === null || player.search_rank === undefined) continue;

    // Skip non-fantasy positions
    if (!isValidPosition(player.position)) continue;

    // Validate team
    if (!isValidTeam(player.team)) {
      errors.push(`Invalid team: ${player.team} for ${player.full_name}`);
      continue;
    }

    // Skip inactive players
    if (player.status === 'Inactive' || player.status === 'Reserve/Retired') continue;

    players.push({
      playerId,
      name: player.full_name,
      position: player.position as Position,
      team: player.team as NFLTeam,
      sleeperAdp: player.search_rank,
      age: player.age,
      yearsExp: player.years_exp,
      status: player.status,
    });
  }

  if (errors.length > 0) {
    console.warn(`\nProcessing warnings (${errors.length}):`);
    errors.slice(0, 10).forEach((e) => console.warn(`  - ${e}`));
    if (errors.length > 10) {
      console.warn(`  ... and ${errors.length - 10} more`);
    }
  }

  // Sort by ADP
  players.sort((a, b) => a.sleeperAdp - b.sleeperAdp);

  return players;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('Sleeper ADP Fetcher');
  console.log('='.repeat(50));

  try {
    // Fetch raw data
    const rawData = await fetchSleeperPlayers();

    // Process and filter
    const players = processSleeperData(rawData);
    console.log(`\nProcessed ${players.length} fantasy-relevant players`);

    // Ensure data directory exists
    await mkdir(DATA_DIR, { recursive: true });

    // Write output
    const output = {
      fetchedAt: new Date().toISOString(),
      source: SLEEPER_PLAYERS_URL,
      playerCount: players.length,
      players,
    };

    await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\nData written to ${OUTPUT_FILE}`);

    // Summary stats
    const positionCounts = players.reduce(
      (acc, p) => {
        acc[p.position] = (acc[p.position] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log('\nPosition breakdown:');
    const entries = Object.entries(positionCounts) as Array<[string, number]>;
    entries.sort((a, b) => b[1] - a[1]);
    for (const entry of entries) {
      console.log(`  ${entry[0]}: ${entry[1]}`);
    }

    // Show top 20 by ADP
    console.log('\nTop 20 by Sleeper ADP:');
    players.slice(0, 20).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} (${p.team}) - ${p.position} - ADP: ${p.sleeperAdp}`);
    });
  } catch (error) {
    console.error('Fetching failed:', error);
    process.exit(1);
  }
}

main();
