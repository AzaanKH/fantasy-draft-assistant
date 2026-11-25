/**
 * Records the target season on a prediction artifact built before the model build wrote it, using the model report
 * from the same build. Shadow Recommendations are not logged from an artifact whose season cannot be recovered.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { MODEL_PATHS } from './model/duckdb.js';
import { recoverPredictionSeason, withPredictionSeason } from './prediction-season-recovery.js';

async function readJson(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  return parsed;
}

async function main(): Promise<void> {
  const predictions = await readJson(MODEL_PATHS.predictionsJson);
  const report = await readJson(MODEL_PATHS.modelReportJson).catch(() => null);
  const season = recoverPredictionSeason(predictions, report);
  const stamped = season === null ? null : withPredictionSeason(predictions, season);
  if (stamped === null) {
    throw new Error(
      `Could not recover the target season: ${MODEL_PATHS.modelReportJson} is missing or is not from the same build. ` +
      'Rebuild with `pnpm model:dataset`; until then Shadow Recommendations are not logged.');
  }
  await writeFile(MODEL_PATHS.predictionsJson, `${JSON.stringify(stamped, null, 2)}\n`);
  console.log(`Recorded season ${String(season)} on ${MODEL_PATHS.predictionsJson}.`);
}

main().catch((error: unknown) => {
  console.error('Prediction season recovery failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
