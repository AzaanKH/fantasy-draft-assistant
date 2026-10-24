import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixedClock, systemClock } from './clock.js';
import { currentSeason } from '../league/season.js';
import { createQuickMockSettings } from '../draft/quick-mock-settings.js';

describe('clock and season', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the system time on each call', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 7, 20) });
    expect(systemClock.now()).toBe(Date.UTC(2026, 7, 20));
    vi.setSystemTime(Date.UTC(2026, 7, 21));
    expect(systemClock.now()).toBe(Date.UTC(2026, 7, 21));
  });

  it('stops a fixed clock at its time', () => {
    const clock = fixedClock(1_000);
    expect([clock.now(), clock.now()]).toEqual([1_000, 1_000]);
  });

  it('derives the UTC calendar season from the clock', () => {
    expect(currentSeason(fixedClock(Date.UTC(2025, 11, 31, 23, 59)))).toBe(2025);
    expect(currentSeason(fixedClock(Date.UTC(2026, 0, 1)))).toBe(2026);
    vi.useFakeTimers({ now: Date.UTC(2027, 5, 1) });
    expect(currentSeason()).toBe(2027);
  });

  it('defaults domain timestamps to the system clock', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 7, 20, 12) });
    expect(createQuickMockSettings().updatedAt).toBe(Date.UTC(2026, 7, 20, 12));
  });
});
