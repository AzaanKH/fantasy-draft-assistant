/** Builds leakage-safe, as-of-draft-morning roster/availability context. */
import { Effect } from 'effect';
import { withModelDb } from './model/duckdb.js';
import { buildHistoricalSnapshots } from './model/historical-snapshots.js';
import { io, runMain } from './effect-runtime.js';

const program = Effect.gen(function* () {
  yield* withModelDb((connection) => io(async () => {
    await buildHistoricalSnapshots(connection);
    console.log('Historical as-of-draft snapshots built.');
  }));
});

runMain(program, 'Historical snapshot build failed:');
