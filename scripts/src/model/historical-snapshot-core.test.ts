import { describe, expect, it } from 'vitest';

import {
  assertInformationCutoff,
  dateOnlyInformationUpperBound,
  latestAsOf,
} from './historical-snapshot-core.js';

describe('historical snapshot timestamp rules', () => {
  it('uses the following midnight as a date-only source upper bound', () => {
    expect(dateOnlyInformationUpperBound('2024-08-30')).toBe('2024-08-31T00:00:00.000Z');
  });

  it('selects only the latest observation known by the cutoff', () => {
    const selected = latestAsOf(
      [
        { id: 'missing-time', informationTimestamp: null },
        { id: 'safe', informationTimestamp: '2024-08-31T00:00:00.000Z' },
        { id: 'future', informationTimestamp: '2024-09-02T00:00:00.000Z' },
      ],
      '2024-09-01T18:21:12.835Z'
    );

    expect(selected?.id).toBe('safe');
  });

  it('admits an observation exactly at the cutoff', () => {
    const cutoff = '2024-09-01T18:21:12.835Z';
    const selected = latestAsOf(
      [{ id: 'equal', informationTimestamp: cutoff }],
      cutoff
    );

    expect(selected?.id).toBe('equal');
    expect(() => assertInformationCutoff(cutoff, cutoff, 'injury')).not.toThrow();
  });

  it('does not treat a same-day date-only observation as known that morning', () => {
    const informationTimestamp = dateOnlyInformationUpperBound('2024-09-01');

    expect(
      latestAsOf(
        [{ id: 'same-day', informationTimestamp }],
        '2024-09-01T18:21:12.835Z'
      )
    ).toBeNull();
  });

  it('keeps missing timestamps missing instead of treating them as old', () => {
    expect(latestAsOf([{ id: 'unknown', informationTimestamp: null }], '2024-09-01T00:00:00Z'))
      .toBeNull();
  });

  it('rejects future information', () => {
    expect(() =>
      assertInformationCutoff(
        '2024-09-02T00:00:00.000Z',
        '2024-09-01T18:21:12.835Z',
        'depth chart'
      )
    ).toThrow(/violates as-of cutoff/);
  });
});
