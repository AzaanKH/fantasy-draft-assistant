import { POSITIONS } from '../player.js';
import { type LeagueSurvivalModel } from '../draft/calculations/survival.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLeagueSurvivalPositionSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['position'] === 'string' &&
    isNumber(value['leagueMedianPick']) &&
    isNumber(value['sleeperMedianPick']) &&
    isNumber(value['pickPremium']) &&
    isNumber(value['top50RateDelta']) &&
    isNumber(value['top100RateDelta']) &&
    isNumber(value['sampleSize'])
  );
}

export function isLeagueSurvivalModel(value: unknown): value is LeagueSurvivalModel {
  if (
    !isRecord(value) ||
    typeof value['generatedAt'] !== 'string' ||
    typeof value['modelVersion'] !== 'string' ||
    typeof value['leagueName'] !== 'string' ||
    !Array.isArray(value['seasons']) ||
    !value['seasons'].every(isNumber) ||
    !isNumber(value['sampleSize']) ||
    !isRecord(value['positions'])
  ) {
    return false;
  }

  const positions = value['positions'];
  const historicalPickNumbers = value['historicalPickNumbers'];
  return POSITIONS.every((position) =>
    isLeagueSurvivalPositionSummary(positions[position])
  ) && (
    historicalPickNumbers === undefined ||
    (
      isRecord(historicalPickNumbers) &&
      POSITIONS.every((position) =>
        Array.isArray(historicalPickNumbers[position]) &&
        historicalPickNumbers[position].every(isNumber)
      )
    )
  );
}
