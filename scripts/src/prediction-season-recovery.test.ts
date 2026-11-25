import { expect, it } from 'vitest';
import { recoverPredictionSeason, withPredictionSeason } from './prediction-season-recovery.js';

const predictions = { generatedAt: '2026-11-13T07:53:45.154Z', modelVersion: 'position-ridge-v4-nested-selection-2021-2025', players: [] };
const report = { generatedAt: '2026-11-13T07:53:45.161Z', modelVersion: 'position-ridge-v4-nested-selection-2021-2025', currentSeason: 2026 };

it('recovers the target season from the model report written by the same build', () => {
  expect(recoverPredictionSeason(predictions, report)).toBe(2026);
});

it('keeps a season the artifact already records', () => {
  expect(recoverPredictionSeason({ ...predictions, season: 2025 }, report)).toBe(2025);
});

it.each([
  ['a different model version', { ...report, modelVersion: 'other' }],
  ['a report from a different build time', { ...report, generatedAt: '2026-11-14T07:53:45.161Z' }],
  ['a report without a season', { ...report, currentSeason: undefined }],
  ['no report', null],
])('fails closed for %s', (_label, candidate) => {
  expect(recoverPredictionSeason(predictions, candidate)).toBeNull();
});

it('writes the season after the model version', () => {
  expect(Object.keys(withPredictionSeason(predictions, 2026) ?? {})).toEqual(['generatedAt', 'modelVersion', 'season', 'players']);
});
