import { asProbability } from '@fantasy-draft/shared/units';
import { describe, expect, it } from 'vitest';
import { describeMissingAvailability, formatAvailabilityPercent, getNextPickAvailability } from './next-pick-availability';

describe('next-pick availability', () => {
  it('reads a modelled estimate with its pick label', () => {
    const availability = getNextPickAvailability({ nextPickSurvivalProbability: asProbability(0.724), nextPickNumber: 15, nextPickLabel: '2.03', survivalModelSource: 'league-history' });
    expect(availability).toEqual({ kind: 'estimate', probability: 0.724, pickLabel: '2.03' });
    expect(formatAvailabilityPercent(availability)).toBe('72%');
    expect(describeMissingAvailability(availability)).toBeNull();
  });

  it('treats a modelled player without a next pick as the final pick, even though the model wrote 100%', () => {
    const availability = getNextPickAvailability({ nextPickSurvivalProbability: asProbability(1), survivalModelSource: 'heuristic' });
    expect(availability.kind).toBe('no-next-pick');
    expect(formatAvailabilityPercent(availability)).toBe('—');
    expect(describeMissingAvailability(availability)).toBe('No later pick');
  });

  it('treats recommendation diagnostics without a probability on the final pick the same way', () => {
    expect(getNextPickAvailability({ nextPickSurvivalProbability: undefined, survivalModelSource: 'league-history' }).kind).toBe('no-next-pick');
  });

  it('never presents a missing estimate as one', () => {
    expect(getNextPickAvailability(undefined).kind).toBe('unestimated');
    expect(getNextPickAvailability({ nextPickSurvivalProbability: Number.NaN as ReturnType<typeof asProbability>, nextPickNumber: 15, survivalModelSource: 'heuristic' }).kind).toBe('unestimated');
    expect(describeMissingAvailability({ kind: 'unestimated' })).toBe('Not estimated');
  });
});
