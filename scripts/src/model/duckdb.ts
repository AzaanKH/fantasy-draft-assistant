import { mkdir, readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { Effect, Exit } from 'effect';
import { io } from '../effect-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = join(__dirname, '../../..');
export const DATA_DIR = join(REPO_ROOT, 'data');
const MODEL_DIR = join(DATA_DIR, 'model');
export const MODEL_DB_PATH = join(MODEL_DIR, 'fantasy-draft.duckdb');
const RAW_MODEL_DIR = join(MODEL_DIR, 'raw');
const NORMALIZED_MODEL_DIR = join(MODEL_DIR, 'normalized');
export const BACKTESTS_MODEL_DIR = join(MODEL_DIR, 'backtests');

export interface ModelPaths {
  readonly fantasyProsSnapshotJson: string;
  readonly sleeperAdpJson: string;
  readonly teamEnvironmentJson: string;
  readonly contractsJson: string;
  readonly leagueDraftHistoryJson: string;
  readonly leagueDraftRawDir: string;
  readonly historicalSnapshotReportJson: string;
  readonly historicalSnapshotsParquet: string;
  readonly predictionsJson: string;
  readonly modelReportJson: string;
  readonly normalizedPlayersParquet: string;
  readonly trainingDatasetParquet: string;
  readonly profileReportJson: string;
}

export const MODEL_PATHS: ModelPaths = {
  fantasyProsSnapshotJson: join(DATA_DIR, 'fantasypros-snapshot.json'),
  sleeperAdpJson: join(DATA_DIR, 'sleeper-adp.json'),
  teamEnvironmentJson: join(DATA_DIR, 'team-environment.json'),
  contractsJson: join(DATA_DIR, 'contracts.json'),
  leagueDraftHistoryJson: join(DATA_DIR, 'league-history', 'leagueDraftHistory.json'),
  leagueDraftRawDir: join(DATA_DIR, 'league-history', 'raw'),
  historicalSnapshotReportJson: join(DATA_DIR, 'historical-snapshot-report.json'),
  historicalSnapshotsParquet: join(MODEL_DIR, 'historical-asof-snapshots.parquet'),
  predictionsJson: join(DATA_DIR, 'predictions.json'),
  modelReportJson: join(DATA_DIR, 'model-report.json'),
  normalizedPlayersParquet: join(NORMALIZED_MODEL_DIR, 'current-player-join.parquet'),
  trainingDatasetParquet: join(MODEL_DIR, 'training-dataset.parquet'),
  profileReportJson: join(MODEL_DIR, 'profile-report.json'),
};

export async function ensureModelDirs(): Promise<void> {
  await Promise.all([
    mkdir(RAW_MODEL_DIR, { recursive: true }),
    mkdir(NORMALIZED_MODEL_DIR, { recursive: true }),
    mkdir(BACKTESTS_MODEL_DIR, { recursive: true }),
  ]);
}

export async function connectModelDb(): Promise<DuckDBConnection> {
  await ensureModelDirs();
  const instance = await DuckDBInstance.fromCache(MODEL_DB_PATH, {
    threads: String(Math.max(1, Math.min(4, availableParallelism()))),
  });
  return instance.connect();
}

/**
 * closeSync blocks until a running query finishes, so cancel any query left
 * running by a failure or Ctrl-C first; otherwise a slow remote read stalls exit.
 */
const closeConnection = (connection: DuckDBConnection, exit: Exit.Exit<unknown, unknown>) => Effect.sync(() => {
  if (Exit.isFailure(exit)) connection.interrupt();
  connection.closeSync();
});

/** A model database connection that is closed when the work finishes, fails, or is interrupted. */
export const withModelDb = <A, E>(use: (connection: DuckDBConnection) => Effect.Effect<A, E>): Effect.Effect<A, E | Error> =>
  Effect.acquireUseRelease(io(connectModelDb), use, closeConnection);

/** A throwaway in-memory database for querying remote Parquet, closed like withModelDb. */
export const withMemoryDb = <A, E>(use: (connection: DuckDBConnection) => Effect.Effect<A, E>): Effect.Effect<A, E | Error> =>
  Effect.acquireUseRelease(
    io(async () => (await DuckDBInstance.create(':memory:')).connect()),
    use,
    closeConnection,
  );

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function runStatements(
  connection: DuckDBConnection,
  statements: readonly string[]
): Promise<void> {
  for (const statement of statements) {
    await connection.run(statement);
  }
}
