import { describe, expect, it } from 'vitest';
import { assertInformationCutoff } from './historical-snapshot-core.js';

describe('historical snapshot timestamp rules', () => {
  it('admits information exactly at the cutoff', () => {
    const cutoff = '2024-09-01T18:21:12.835Z';
    expect(() => assertInformationCutoff(cutoff, cutoff, 'injury')).not.toThrow();
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
