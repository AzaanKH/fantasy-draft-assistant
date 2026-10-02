import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RecommendationEvaluation {
  readonly generatedAt: string;
  readonly modelVersion: string;
  readonly evaluatedArchitecture: 'pick-ev-v1';
  readonly [key: string]: unknown;
}

const RUNTIME_FIELDS = [
  'recommendationArchitecture',
  'modelPredictionsEnabled',
  'contractSignalEnabled',
  'pickEvOverrideEnabled',
  'fallback',
  'shadowLogging',
];

export function isRecommendationEvaluation(value: unknown): value is RecommendationEvaluation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record['generatedAt'] === 'string' &&
    Number.isFinite(Date.parse(record['generatedAt'])) &&
    typeof record['modelVersion'] === 'string' &&
    record['evaluatedArchitecture'] === 'pick-ev-v1' &&
    RUNTIME_FIELDS.every((key) => !Object.hasOwn(record, key));
}

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
