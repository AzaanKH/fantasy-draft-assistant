/** The calendar-year season containing `time`, in UTC. */
export function calendarSeason(time: number): number {
  return new Date(time).getUTCFullYear();
}
