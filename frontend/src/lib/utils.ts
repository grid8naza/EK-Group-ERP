export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * A date as a person writes it here: dd/mm/yy.
 *
 * For reports and printed documents, where an ISO date reads as a machine
 * timestamp and the year in full costs width a wide table cannot spare. The
 * time is dropped — the things dated this way are days, not moments.
 *
 * A date-only string is read back as UTC, because that is how the engine parses
 * it; taking it as local would show the day before to anybody west of
 * Greenwich. A value that will not parse comes back untouched rather than as
 * "Invalid Date": a report should show what it was given, not complain about it.
 */
export function formatDayMonthYear(value?: string | null): string {
  if (!value) return '-';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = dateOnly ? d.getUTCDate() : d.getDate();
  const month = (dateOnly ? d.getUTCMonth() : d.getMonth()) + 1;
  const year = dateOnly ? d.getUTCFullYear() : d.getFullYear();
  return `${pad(day)}/${pad(month)}/${pad(year % 100)}`;
}

export function formatDate(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
