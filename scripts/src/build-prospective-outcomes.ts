import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { decodeBacktestLeagueHistory } from './script-file-schemas.js';
import { DATA_DIR, runStatements, withModelDb } from './model/duckdb.js';
import { PROSPECTIVE_FIRST_SEASON, prospectiveOutcomeStatements } from './model/prospective-fold.js';
import { io, isEntryPoint, runMain } from './effect-runtime.js';

/** Fetches season-to-date nflverse outcomes for every imported league season drafted after the model declaration. */
const program = Effect.gen(function* () {
  const history = decodeBacktestLeagueHistory(JSON.parse(yield* io(() =>
    readFile(join(DATA_DIR, 'league-history', 'leagueDraftHistory.json'), 'utf8')
  )));
  const seasons = history.seasons
    .map((season) => season.season)
    .filter((season) => season >= PROSPECTIVE_FIRST_SEASON)
    .sort((a, b) => a - b);
  if (seasons.length === 0) {
    console.log(`No league season from ${String(PROSPECTIVE_FIRST_SEASON)} on; run pnpm --filter scripts import:league-history.`);
    return;
  }
  yield* withModelDb((connection) => io(async () => {
    await runStatements(connection, prospectiveOutcomeStatements(seasons));
    const status = await connection.runAndReadAll('select * from model.prospective_season_status order by season');
    for (const row of status.getRowObjects()) {
      console.log(
        `Season ${String(row.season)}: ${String(row.reg_games_played)}/${String(row.reg_games_scheduled)} ` +
        `regular-season games scored, ${String(row.reg_games_with_stats)} matched to player stats, ` +
        `through week ${String(row.last_week_played)}.`
      );
    }
  }));
});

if (isEntryPoint(import.meta.url)) {
  runMain(program);
}
