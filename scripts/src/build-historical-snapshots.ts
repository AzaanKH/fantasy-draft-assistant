/** Builds leakage-safe, as-of-draft-morning roster/availability context. */
import { connectModelDb } from './model/duckdb.js';
import { buildHistoricalSnapshots } from './model/historical-snapshots.js';

async function main(): Promise<void> {
  const connection = await connectModelDb();
  try {
    await buildHistoricalSnapshots(connection);
    console.log('Historical as-of-draft snapshots built.');
  } finally {
    connection.closeSync();
  }
}

main().catch((error: unknown) => {
  console.error('Historical snapshot build failed:', error);
  process.exit(1);
});
