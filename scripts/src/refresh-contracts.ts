/**
 * Builds current contract-year context from nflverse's OverTheCap history.
 *
 * Contract status remains descriptive until it clears a separate historical
 * recommendation backtest; the live recommendation policy keeps it disabled.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { NFLTeam, Position } from '@fantasy-draft/shared';
import { DATA_DIR } from './model/duckdb.js';

const CONTRACTS_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet';
const CONTRACTS_RELEASE_API_URL =
  'https://api.github.com/repos/nflverse/nflverse-data/releases/tags/contracts';
const PLAYER_IDS_URL =
  'https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv';
const OUTPUT_FILE = join(DATA_DIR, 'contracts.json');
const SLEEPER_FILE = join(DATA_DIR, 'sleeper-adp.json');

interface ContractRow {
  readonly sleeper_player_id: string | bigint;
  readonly gsis_id: string;
  readonly contract_end_year: number | bigint;
}

interface SleeperPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
}

interface SleeperFile {
  readonly players: readonly SleeperPlayer[];
}

async function getSourceUpdatedAt(): Promise<string | null> {
  const response = await fetch(CONTRACTS_RELEASE_API_URL, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'fantasy-draft-contract-refresh' },
  });
  if (!response.ok) return null;
  const release = await response.json() as {
    readonly updated_at?: string;
    readonly assets?: readonly { readonly name?: string; readonly updated_at?: string }[];
  };
  return release.assets?.find((asset) => asset.name === 'historical_contracts.parquet')?.updated_at ??
    release.updated_at ?? null;
}

async function main(): Promise<void> {
  const contractYear = new Date().getFullYear();
  const sleeper = JSON.parse(await readFile(SLEEPER_FILE, 'utf8')) as SleeperFile;
  const sleeperById = new Map(sleeper.players.map((player) => [player.playerId, player]));
  const database = await DuckDBInstance.create(':memory:');
  const connection = await database.connect();

  try {
    const reader = await connection.runAndReadAll(`
      with contracts as (
        select
          gsis_id::varchar as gsis_id,
          position::varchar as position,
          list_max(list_transform(cols, item -> try_cast(item.year as integer)))
            as contract_end_year
        from read_parquet('${CONTRACTS_URL}')
        where is_active
          and position in ('QB', 'RB', 'WR', 'TE')
          and gsis_id is not null
      ),
      players as (
        select gsis_id, sleeper_player_id
        from (
          select
            gsis_id::varchar as gsis_id,
            sleeper_id::varchar as sleeper_player_id,
            row_number() over (partition by gsis_id order by db_season desc) as recency_rank
          from read_csv_auto('${PLAYER_IDS_URL}')
          where sleeper_id is not null and gsis_id is not null
        )
        where recency_rank = 1
      )
      select
        players.sleeper_player_id,
        contracts.gsis_id,
        contracts.contract_end_year
      from contracts
      join players using (gsis_id)
      where contracts.contract_end_year = ${String(contractYear)}
    `);
    const rows = reader.getRowObjects() as unknown as ContractRow[];
    const players = rows.flatMap((row) => {
      const sleeperPlayer = sleeperById.get(String(row.sleeper_player_id));
      if (!sleeperPlayer) return [];
      return [{
        playerId: sleeperPlayer.playerId,
        gsisId: row.gsis_id,
        name: sleeperPlayer.name,
        position: sleeperPlayer.position,
        team: sleeperPlayer.team,
        contractEndYear: Number(row.contract_end_year),
        isContractYear: true,
      }];
    });
    const uniquePlayers = [...new Map(players.map((player) => [player.playerId, player])).values()]
      .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
    const sourceUpdatedAt = await getSourceUpdatedAt();

    await writeFile(OUTPUT_FILE, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      contractYear,
      playerCount: uniquePlayers.length,
      source: CONTRACTS_URL,
      sourceUpdatedAt,
      sourceDescription: 'nflverse historical contracts sourced from OverTheCap',
      signalPolicy: 'context-only-until-backtested',
      players: uniquePlayers,
    }, null, 2)}\n`);
    console.log(`Contract context written: ${String(uniquePlayers.length)} current Sleeper players.`);
  } finally {
    connection.closeSync();
  }
}

main().catch((error: unknown) => {
  console.error('Contract refresh failed:', error);
  process.exit(1);
});
