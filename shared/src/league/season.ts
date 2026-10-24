import { systemClock, type Clock } from '../units/clock.js';

/** The calendar-year season containing `time`, in UTC. */
export function calendarSeason(time: number): number {
  return new Date(time).getUTCFullYear();
}

/** The draft season for the clock's current time. */
export function currentSeason(clock: Clock = systemClock): number {
  return calendarSeason(clock.now());
}
