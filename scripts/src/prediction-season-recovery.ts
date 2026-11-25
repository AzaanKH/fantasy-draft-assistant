/**
 * Prediction artifacts built before `season` was recorded can recover it from the model report the same build wrote.
 * The report counts as the same build only when its model version matches and it was written within a minute of the
 * predictions; anything else stays unrecovered, so Shadow Recommendation logging fails closed.
 */

const SAME_BUILD_WINDOW_MS = 60_000;

export function recoverPredictionSeason(predictions: unknown, report: unknown): number | null {
  if (!isRecord(predictions) || !isRecord(report)) return null;
  const recorded = predictions['season'];
  if (typeof recorded === 'number' && Number.isInteger(recorded)) return recorded;
  const season = report['currentSeason'];
  if (typeof season !== 'number' || !Number.isInteger(season)) return null;
  if (typeof predictions['modelVersion'] !== 'string' || predictions['modelVersion'] !== report['modelVersion']) return null;
  const predictionsAt = Date.parse(String(predictions['generatedAt']));
  const reportAt = Date.parse(String(report['generatedAt']));
  if (Number.isNaN(predictionsAt) || Number.isNaN(reportAt) || Math.abs(predictionsAt - reportAt) > SAME_BUILD_WINDOW_MS) return null;
  return season;
}

/** Inserts `season` after `modelVersion`, matching the order the model build writes; null for a non-object artifact. */
export function withPredictionSeason(predictions: unknown, season: number): Record<string, unknown> | null {
  if (!isRecord(predictions)) return null;
  const stamped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(predictions)) {
    if (key === 'season') continue;
    stamped[key] = value;
    if (key === 'modelVersion') stamped['season'] = season;
  }
  if (!('season' in stamped)) stamped['season'] = season;
  return stamped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
