export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
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
