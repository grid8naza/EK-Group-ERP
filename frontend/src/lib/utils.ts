export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * A date as a person writes it here: dd/mm/yyyy.
 *
 * THE date format of this application — screens, reports and printed documents
 * alike. Nothing shows a date any other way: an ISO date reads as a machine
 * timestamp, and the browser's own locale would show a New York user a date
 * their Gulf colleague reads as a different day. The time is dropped — the
 * things dated this way are days, not moments. The year is written in full: a
 * service record spans decades, and "01/01/30" leaves the reader deciding
 * whether that is 1930 or 2030.
 *
 * A date-only string is read back as UTC, because that is how the engine parses
 * it; taking it as local would show the day before to anybody west of
 * Greenwich. A value that will not parse comes back untouched rather than as
 * "Invalid Date": a report should show what it was given, not complain about it.
 */
export function formatDayMonthYear(value?: string | Date | null): string {
  if (!value) return '-';
  // A Date has already been resolved to a moment in this zone; only a bare
  // yyyy-mm-dd string needs the UTC reading below.
  const raw = typeof value === 'string' ? value : null;
  const dateOnly = raw ? /^\d{4}-\d{2}-\d{2}$/.test(raw) : false;
  const d =
    raw === null
      ? (value as Date)
      : new Date(dateOnly ? `${raw}T00:00:00Z` : raw);
  if (isNaN(d.getTime())) return raw ?? '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = dateOnly ? d.getUTCDate() : d.getDate();
  const month = (dateOnly ? d.getUTCMonth() : d.getMonth()) + 1;
  const year = dateOnly ? d.getUTCFullYear() : d.getFullYear();
  return `${pad(day)}/${pad(month)}/${year}`;
}

/**
 * A moment: the same dd/mm/yyyy, with the clock after it.
 *
 * For the things where the time of day is the point — when a document was
 * raised, when a cost was last recomputed, when a backup ran. The date half is
 * written exactly as {@link formatDayMonthYear} writes it, so a column of
 * timestamps and a column of dates line up as the same format.
 *
 * `withSeconds` for audit-flavoured places, where two entries a few seconds
 * apart need telling apart.
 */
export function formatDateTime(
  value?: string | Date | null,
  opts?: { withSeconds?: boolean },
): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return typeof value === 'string' ? value : '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${
    opts?.withSeconds ? `:${pad(d.getSeconds())}` : ''
  }`;
  return `${formatDayMonthYear(value)} ${time}`;
}

/**
 * A price or percentage for display: always two decimals, with thousands
 * separators ("38.6" → "38.60", 1750 → "1,750.00").
 *
 * Money and margins are read down a column and compared against each other, so
 * a ragged number of decimals makes them hard to scan; quantities are NOT this
 * — those follow their unit's own decimal places from the Unit master.
 */
export function money2(value?: number | string | null): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Normalise an editable price / percentage string to two decimals, for an
 * input's onBlur. Blank and non-numeric input passes straight through, so
 * typing stays natural and an empty field stays empty.
 */
export function dec2(s: string): string {
  if (s.trim() === '') return s;
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(2) : s;
}

/**
 * A Date as YYYY-MM-DD in the user's OWN timezone.
 *
 * Not `toISOString().slice(0, 10)`, which is the UTC date: in a UTC+4 office
 * anything entered before 4am would be stamped with yesterday, and a voucher
 * dated a day early is a voucher in the wrong period.
 */
export function isoDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
