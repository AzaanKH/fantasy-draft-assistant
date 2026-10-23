import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Schema } from 'effect';

const CONTRACT_SIGNAL_FIELDS = [
  'contractSignalGeneratedAt',
  'contractSignalValidationPassed',
  'contractSignalModelVersion',
  'contractSignalReason',
] as const;

const RUNTIME_FIELDS = [
  'recommendationArchitecture',
  'modelPredictionsEnabled',
  'contractSignalEnabled',
  'pickEvOverrideEnabled',
  'fallback',
  'shadowLogging',
];

const recommendationEvaluation = Schema.StructWithRest(Schema.Struct({
  generatedAt: Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value)))),
  modelVersion: Schema.String,
  evaluatedArchitecture: Schema.Literal('pick-ev-v1'),
}), [Schema.Record(Schema.String, Schema.Unknown)]).check(
  Schema.makeFilter(value => RUNTIME_FIELDS.every(key => !Object.hasOwn(value, key)))
);

type RecommendationEvaluation = typeof recommendationEvaluation.Type;
export const isRecommendationEvaluation = Schema.is(recommendationEvaluation);

/** Backtests own evaluation evidence; runtime policy is maintained separately. */
export async function writeRecommendationEvaluation(
  dataDirectory: string,
  evaluation: RecommendationEvaluation
): Promise<void> {
  if (!isRecommendationEvaluation(evaluation)) {
    throw new Error('Recommendation evaluation must contain historical evidence without runtime settings');
  }
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(join(dataDirectory, 'recommendation-evaluation.json'), `${JSON.stringify(evaluation, null, 2)}\n`);
}

/** Contract backtests own these fields; recommendation backtests carry them forward unchanged. */
export async function readContractSignalEvidence(
  dataDirectory: string
): Promise<Record<string, unknown>> {
  let saved: unknown;
  try {
    saved = JSON.parse(await readFile(join(dataDirectory, 'recommendation-evaluation.json'), 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
  if (!isRecommendationEvaluation(saved)) return {};
  return Object.fromEntries(
    CONTRACT_SIGNAL_FIELDS.filter((key) => Object.hasOwn(saved, key)).map((key) => [key, saved[key]])
  );
}
