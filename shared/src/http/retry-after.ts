const MIN_RETRY_DELAY_MS = 500;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TIME = String.raw`(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})`;
const IMF_FIXDATE = new RegExp(String.raw`^[a-z]{3}, (?<day>\d{2}) (?<month>[a-z]{3}) (?<year>\d{4}) ${TIME} GMT$`, 'i');
const RFC_850_DATE = new RegExp(String.raw`^[a-z]+, (?<day>\d{2})-(?<month>[a-z]{3})-(?<shortYear>\d{2}) ${TIME} GMT$`, 'i');
const ASCTIME_DATE = new RegExp(String.raw`^[a-z]{3} (?<month>[a-z]{3}) (?<day>[ \d]\d) ${TIME} (?<year>\d{4})$`, 'i');
const HTTP_DATE_FORMATS = [IMF_FIXDATE, RFC_850_DATE, ASCTIME_DATE];

/**
 * Parse the three HTTP-date formats (RFC 9110, section 5.6.7) as UTC. Date.parse
 * reads asctime in local time and two-digit years as the 1900s, so it is not used.
 */
const parseHttpDate = (value: string, now: number): number => {
  const date = HTTP_DATE_FORMATS.map((format) => format.exec(value)?.groups).find(Boolean);
  if (!date) return NaN;
  const month = MONTHS.indexOf(String(date.month).toLowerCase());
  const [day, hour, minute, second] = [date.day, date.hour, date.minute, date.second].map(Number) as [number, number, number, number];
  // Date.UTC rolls overflowing fields into the next unit, so a date that does not
  // read back unchanged was invalid. Seconds go up to 60 for a leap second.
  const toTimestamp = (year: number): number => {
    const minuteStart = new Date(Date.UTC(year, month, day, hour, minute));
    const valid = month >= 0 && second <= 60 && minuteStart.getUTCFullYear() === year && minuteStart.getUTCMonth() === month
      && minuteStart.getUTCDate() === day && minuteStart.getUTCHours() === hour && minuteStart.getUTCMinutes() === minute;
    return valid ? minuteStart.getTime() + second * 1000 : NaN;
  };
  if (date.shortYear === undefined) return toTimestamp(Number(date.year));
  // A two-digit year that would put the date more than 50 years ahead is in the most recent past century.
  const currentYear = new Date(now).getUTCFullYear();
  const year = currentYear - (currentYear % 100) + Number(date.shortYear);
  const fiftyYearsAhead = new Date(now);
  fiftyYearsAhead.setUTCFullYear(currentYear + 50);
  const timestamp = toTimestamp(year);
  return timestamp > fiftyYearsAhead.getTime() ? toTimestamp(year - 100) : timestamp;
};

/**
 * Retry-After is either delay-seconds or an HTTP date (RFC 9110, section 10.2.3).
 * Delay-seconds too large for a number become Infinity, so they still exceed any wait limit.
 */
export const parseRetryAfter = (value: string | null, now: number = Date.now()): number | undefined => {
  if (value === null) return undefined;
  const trimmed = value.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : parseHttpDate(trimmed, now) - now;
  return Number.isNaN(ms) ? undefined : Math.max(MIN_RETRY_DELAY_MS, ms);
};
