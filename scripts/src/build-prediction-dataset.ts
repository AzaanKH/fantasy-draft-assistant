/**
 * Builds the model-ready fantasy football datasets from historical sources.
 *
 * Source responsibilities:
 * - nflreadpy / nflverse: historical NFL stats, snap share, Next Gen Stats, rosters,
 *   schedules, team stats, and player IDs
 * - ffopportunity / ffverse: expected fantasy points and opportunity metrics
 * - DynastyProcess / ffverse rankings: historical pre-draft and market-style rankings
 */

import { access } from 'node:fs/promises';
import { Effect } from 'effect';
import { fixedClock } from '@fantasy-draft/shared/units';
import { decodeFantasyProsSnapshot, decodeSleeperDataFile } from '@fantasy-draft/shared/catalog';
import { currentSeason } from '@fantasy-draft/shared/league';
import {
  EXCLUDES_FANTASYPROS,
  MODEL_PATHS,
  withModelDb,
  readJsonFile,
  runStatements,
} from './model/duckdb.js';
import { buildHistoricalSnapshots } from './model/historical-snapshots.js';
import { io, isEntryPoint, runMain } from './effect-runtime.js';
import { writePredictionArtifacts } from './prediction-dataset/artifacts.js';
import { buildLeagueHistoryTables } from './prediction-dataset/league-history-tables.js';
import { fitAndStorePositionResidualModels } from './prediction-dataset/position-residual-tables.js';
import { predictionOutputStatements } from './prediction-dataset/prediction-output-tables.js';
import { seasonFeatureTableStatements } from './prediction-dataset/season-feature-tables.js';
import { sourceTableStatements } from './prediction-dataset/source-tables.js';
import { trainingTableStatements } from './prediction-dataset/training-tables.js';

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getSeasonWindow(currentSeason: number): readonly number[] {
  const completedSeason = currentSeason - 1;
  const envStart = Number(process.env['MODEL_HISTORY_START_SEASON']);
  const envEnd = Number(process.env['MODEL_HISTORY_END_SEASON']);
  const start = Number.isInteger(envStart) ? envStart : Math.max(2021, completedSeason - 4);
  const end = Number.isInteger(envEnd) ? envEnd : completedSeason;
  return range(start, end);
}

function seasonAt(timestamp: string | undefined): number {
  const time = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isNaN(time) ? currentSeason() : currentSeason(fixedClock(time));
}

export function readCurrentSeason(): Effect.Effect<number, Error> {
  if (EXCLUDES_FANTASYPROS) {
    return io(() => readJsonFile(MODEL_PATHS.sleeperAdpJson, value => decodeSleeperDataFile(value, { onWarning: console.warn }))).pipe(
      Effect.map((sleeper) => seasonAt(sleeper.fetchedAt))
    );
  }
  return io(() => readJsonFile(MODEL_PATHS.fantasyProsSnapshotJson, decodeFantasyProsSnapshot)).pipe(
    Effect.map((snapshot) => snapshot.metadata.season)
  );
}

const program = Effect.gen(function* () {
  const currentSeason = yield* readCurrentSeason();
  const seasons = getSeasonWindow(currentSeason);
  const modelVersion =
    `position-ridge-v4-nested-selection-${seasons[0]}-${seasons[seasons.length - 1]}` +
    (EXCLUDES_FANTASYPROS ? '-fantasypros-free' : '');
  const hasLeagueHistory = yield* io(() => exists(MODEL_PATHS.leagueDraftHistoryJson));
  yield* withModelDb((connection) => io(async () => {
    await buildHistoricalSnapshots(connection);
    await runStatements(connection, [
      ...sourceTableStatements(seasons),
      ...seasonFeatureTableStatements(currentSeason),
      ...trainingTableStatements(currentSeason),
    ]);
    const fittedPositionModels = await fitAndStorePositionResidualModels(connection, currentSeason);
    await runStatements(connection, predictionOutputStatements(fittedPositionModels));
    await buildLeagueHistoryTables(connection, hasLeagueHistory);
    await writePredictionArtifacts(connection, { modelVersion, seasons, currentSeason, fittedPositionModels });
  }));
});

if (isEntryPoint(import.meta.url)) {
  runMain(program, 'Prediction dataset build failed:');
}
