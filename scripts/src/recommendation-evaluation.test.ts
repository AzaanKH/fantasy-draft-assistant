import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isRecommendationEvaluation,
  readContractSignalEvidence,
  writeRecommendationEvaluation,
} from './recommendation-evaluation.js';

const evaluation = {
  generatedAt: '2026-09-05T15:18:41.777Z',
  modelVersion: 'historical-model',
  evaluatedArchitecture: 'pick-ev-v1' as const,
  pickEvOverrideThreshold: 4,
  pickEvOverrideValidation: { passed: true },
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('historical recommendation evaluation', () => {
  it('writes passing evaluation evidence without changing runtime policy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'recommendation-evaluation-'));
    directories.push(directory);
    const runtime = JSON.stringify({ recommendationArchitecture: 'best-pick-policy', modelPredictionsEnabled: false });
    await writeFile(join(directory, 'recommendation-policy.json'), runtime);

    await writeRecommendationEvaluation(directory, evaluation);

    expect(await readFile(join(directory, 'recommendation-policy.json'), 'utf8')).toBe(runtime);
    expect(JSON.parse(await readFile(join(directory, 'recommendation-evaluation.json'), 'utf8'))).toEqual(evaluation);
  });

  it.each(['recommendationArchitecture', 'modelPredictionsEnabled', 'contractSignalEnabled', 'pickEvOverrideEnabled', 'fallback', 'shadowLogging'])(
    'rejects runtime setting %s in historical evidence before writing', async (field) => {
      const directory = await mkdtemp(join(tmpdir(), 'recommendation-evaluation-'));
      directories.push(directory);
      await expect(writeRecommendationEvaluation(directory, { ...evaluation, [field]: true })).rejects.toThrow('without runtime settings');
      await expect(readFile(join(directory, 'recommendation-evaluation.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('carries the contract backtest result forward when the recommendation backtest rewrites evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'recommendation-evaluation-'));
    directories.push(directory);
    expect(await readContractSignalEvidence(directory)).toEqual({});
    const contractEvidence = {
      contractSignalGeneratedAt: '2026-09-04T00:00:00.000Z',
      contractSignalValidationPassed: true,
      contractSignalModelVersion: 'contract-model',
      contractSignalReason: 'Clears the gate.',
    };
    await writeRecommendationEvaluation(directory, { ...evaluation, ...contractEvidence, decision: 'old' });

    await writeRecommendationEvaluation(directory, {
      ...evaluation,
      generatedAt: '2026-09-06T00:00:00.000Z',
      ...await readContractSignalEvidence(directory),
    });

    expect(JSON.parse(await readFile(join(directory, 'recommendation-evaluation.json'), 'utf8'))).toEqual({
      ...evaluation,
      generatedAt: '2026-09-06T00:00:00.000Z',
      ...contractEvidence,
    });
  });

  it('preserves the saved backtest metadata as evaluation rather than runtime settings', async () => {
    const saved: unknown = JSON.parse(await readFile(new URL('../../data/recommendation-evaluation.json', import.meta.url), 'utf8'));
    expect(isRecommendationEvaluation(saved)).toBe(true);
  });
});
