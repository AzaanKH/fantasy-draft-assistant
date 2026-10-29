import { describe, expect, it } from 'vitest';
import { assertObservedNearNow, ObservationOrder } from './espn-observation.js';

describe('assertObservedNearNow', () => {
  it('accepts observations within five minutes of now and rejects the rest', () => {
    const now = 1_000_000_000;
    expect(() => { assertObservedNearNow(now - 5 * 60_000, now); }).not.toThrow();
    expect(() => { assertObservedNearNow(now + 5 * 60_000, now); }).not.toThrow();
    for (const observedAt of [now - 5 * 60_000 - 1, now + 5 * 60_000 + 1]) {
      expect(() => { assertObservedNearNow(observedAt, now); }).toThrow(expect.objectContaining({ status: 400 }));
    }
  });
});

describe('ObservationOrder', () => {
  it('rejects a snapshot observed before the latest applied one', () => {
    const order = new ObservationOrder();
    expect(order.commit(20, () => 'applied')).toBe('applied');
    expect(order.commit(20, () => 'same time')).toBe('same time');
    expect(() => order.commit(19, () => 'stale')).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('does not advance past a snapshot that failed to apply', () => {
    const order = new ObservationOrder();
    order.commit(10, () => undefined);
    expect(() => order.commit(30, () => { throw new Error('Invalid draft metadata or picks'); })).toThrow('Invalid draft metadata or picks');
    expect(order.commit(20, () => 'applied')).toBe('applied');
  });
});
