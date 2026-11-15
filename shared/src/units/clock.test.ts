import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from './clock.js';
import { currentSeason } from '../league/season.js';
import { createQuickMockSettings } from '../draft/quick-mock-settings.js';

describe('clock and season', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults the season and domain timestamps to the system clock', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 7, 20, 12) });
    expect(currentSeason()).toBe(2026);
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
