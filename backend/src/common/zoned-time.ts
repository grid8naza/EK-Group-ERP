/**
 * Local time, for the things that happen at a time of DAY rather than at an
 * instant: a 6 a.m. opening checklist, a shift, a daily cut-off.
 *
 * The server runs in UTC (no TZ is set on the container), and the bakery does
 * not. Left alone, "06:00" stored by a supervisor in Kerala would fire at 11:30
 * their morning — which is not a rounding error, it is the opening checks
 * arriving after the shop has opened. So a time of day is interpreted in the
 * APPLICATION's zone, which is stated here rather than guessed per request.
 *
 * `Intl.DateTimeFormat` does the whole job with no dependency: format a UTC
 * instant in the target zone, read the pieces back, and the difference between
 * them and the instant IS the offset — correct through DST changes, wherever the
 * group later operates.
 *
 * ONE zone for the application, not one per company. The group is in Kerala; the
 * day a company in another zone joins it, this becomes a column on Company and
 * every caller below takes the zone as an argument. That change is contained
 * here on purpose.
 */

/** The zone times of day are read in. Override with APP_TIMEZONE. */
export const appTimeZone = (): string =>
  process.env.APP_TIMEZONE || 'Asia/Kolkata';

/** The parts of one instant, as they read on a clock in `timeZone`. */
export interface ZonedParts {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday, to match JS and the weekday pickers. */
  weekday: number;
  /** 1-31. */
  dayOfMonth: number;
}

const PARTS_FORMAT = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Read an instant as a local clock and calendar. */
export function zonedParts(at: Date, timeZone = appTimeZone()): ZonedParts {
  const parts = new Map(
    PARTS_FORMAT(timeZone)
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const year = parts.get('year') ?? '1970';
  const month = parts.get('month') ?? '01';
  const day = parts.get('day') ?? '01';
  // 'en-CA' with hour12:false gives 24-hour clock, but midnight comes back as
  // '24' in some runtimes — normalised, or a checklist at 00:15 would be read
  // as 24:15 and never come due.
  const hour = Number(parts.get('hour') ?? '0') % 24;
  const minute = Number(parts.get('minute') ?? '0');

  return {
    date: `${year}-${month}-${day}`,
    minutes: hour * 60 + minute,
    weekday: Math.max(0, WEEKDAYS.indexOf(parts.get('weekday') ?? 'Sun')),
    dayOfMonth: Number(day),
  };
}

/**
 * The offset of `timeZone` at the given instant, in minutes east of UTC
 * (IST → +330). Asked at an instant rather than in general, because zones with
 * DST have two answers.
 */
export function zoneOffsetMinutes(at: Date, timeZone = appTimeZone()): number {
  const parts = new Map(
    PARTS_FORMAT(timeZone)
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  // Rebuild the local reading AS IF it were UTC. How far that lands from the
  // real instant is exactly the offset.
  const asUtc = Date.UTC(
    Number(parts.get('year')),
    Number(parts.get('month')) - 1,
    Number(parts.get('day')),
    Number(parts.get('hour')) % 24,
    Number(parts.get('minute')),
    Number(parts.get('second')),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The instant at which a local date and time of day occurs.
 *
 * `date` is `YYYY-MM-DD` as it reads locally, `minutes` is minutes after local
 * midnight. Minutes beyond a day are allowed and roll forward, which is how a
 * "due by 01:00 the next morning" is expressed.
 */
export function zonedToInstant(
  date: string,
  minutes: number,
  timeZone = appTimeZone(),
): Date {
  const wallClock = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60_000;
  // The offset has to be measured near the answer, not at UTC midnight, or a
  // DST boundary between the two would shift the result by an hour.
  const offset = zoneOffsetMinutes(new Date(wallClock), timeZone);
  return new Date(wallClock - offset * 60_000);
}

/** The date-only marker for a local calendar date (midnight UTC that day). */
export function dateMarker(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * The weekday and day-of-month of a local calendar date, without needing a zone.
 *
 * `YYYY-MM-DD` already IS local — which day of the week it falls on is a fact
 * about the calendar, not about anybody's clock. Used to walk forward looking for
 * the next date a schedule runs on.
 */
export function calendarParts(date: string): ZonedParts {
  const [year, month, day] = date.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  return { date, minutes: 0, weekday: at.getUTCDay(), dayOfMonth: day };
}

/** `YYYY-MM-DD` plus n days, as another `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day + days));
  return at.toISOString().slice(0, 10);
}

/**
 * A date as it is written to a person: dd/mm/yyyy.
 *
 * The house format, the same one the screens use. Only for text a human reads —
 * an alert body, an error message. Anything crossing the wire as data stays ISO,
 * because that is what the client parses.
 *
 * Read as UTC: a stored date-only value is midnight UTC that day, and taking it
 * as local would name the day before for anybody west of Greenwich.
 */
export function formatDayMonthYear(value: Date | string): string {
  const at = typeof value === 'string' ? dateMarker(value.slice(0, 10)) : value;
  if (isNaN(at.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()}`;
}

/** `360` → `06:00`, for anything that shows a stored time of day. */
export function formatMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
