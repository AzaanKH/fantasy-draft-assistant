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

  it('derives the UTC NFL season from the clock', () => {
    expect(currentSeason(fixedClock(Date.UTC(2025, 11, 31, 23, 59)))).toBe(2025);
    expect(currentSeason(fixedClock(Date.UTC(2026, 0, 1)))).toBe(2025);
    vi.useFakeTimers({ now: Date.UTC(2027, 5, 1) });
    expect(currentSeason()).toBe(2027);
  });

  it('defaults domain timestamps to the system clock', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 7, 20, 12) });
    expect(createQuickMockSettings().updatedAt).toBe(Date.UTC(2026, 7, 20, 12));
  });
});

it.each([
  ['2026-02-28T23:59:59.999Z', 2025],
  ['2026-03-01T00:00:00.000Z', 2026],
  ['2026-12-31T23:59:59.999Z', 2026],
  ['2027-01-01T00:00:00.000Z', 2026],
  ['2026-12-31T15:59:59.999-08:00', 2026],
  ['2026-12-31T16:00:00.000-08:00', 2026],
  ['2026-12-31T19:00:00.000-05:00', 2026],
  ['2026-02-28T16:00:00.000-08:00', 2026],
  ['2026-02-28T19:00:00.000-05:00', 2026],
])('uses the NFL season at %s', (timestamp, season) => {
  expect(currentSeason(fixedClock(Date.parse(timestamp)))).toBe(season);
});
