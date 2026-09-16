import { describe, expect, it } from 'vitest';
import { createDataFreshnessItem, formatDataAge } from './data-freshness';

const NOW = Date.parse('2026-08-08T12:00:00Z');

describe('createDataFreshnessItem', () => {
  it('marks artifacts within their maximum age as fresh', () => {
    const result = createDataFreshnessItem({
      key: 'rankings',
      label: 'Rankings',
      timestamp: '2026-08-08T00:00:00Z',
      maxAgeHours: 24,
      refreshCommand: 'pnpm refresh:rankings',
      requiredForLiveDraft: true,
    }, NOW);

    expect(result.isFresh).toBe(true);
    expect(result.ageHours).toBe(12);
  });

  it('marks expired or missing artifacts as stale', () => {
    const expired = createDataFreshnessItem({
      key: 'sportsbook',
      label: 'Sportsbook',
      timestamp: '2026-08-05T00:00:00Z',
      maxAgeHours: 48,
      refreshCommand: 'pnpm import:sportsbook',
      requiredForLiveDraft: false,
    }, NOW);
    const missing = createDataFreshnessItem({
      key: 'identity',
      label: 'Player identity',
      timestamp: null,
      maxAgeHours: 24,
      refreshCommand: 'pnpm data:identity',
      requiredForLiveDraft: true,
    }, NOW);

    expect(expired.isFresh).toBe(false);
    expect(missing.isFresh).toBe(false);
    expect(missing.ageHours).toBeNull();
  });
});

describe('formatDataAge', () => {
  it('formats unknown, hourly, and daily ages', () => {
    expect(formatDataAge(null)).toBe('unknown age');
    expect(formatDataAge(4.9)).toBe('4h old');
    expect(formatDataAge(73)).toBe('3d old');
  });
});
