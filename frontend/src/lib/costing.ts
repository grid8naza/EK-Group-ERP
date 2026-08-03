import type { ProductCostVariance } from '@/lib/types';

/**
 * Shared bits of the two cost-review screens.
 *
 * The review is split by whether a product is sold, because the two ask
 * different questions:
 *  - Price Review  (/production/price-review, canSell) — does each selling price
 *    still earn the margin it was set to earn? Cost is an input to that.
 *  - Cost Review   (/production/cost-review, !canSell) — a semi-finished
 *    intermediate is never sold, so it has no price to hold anything against.
 *    All there is to review is whether its cost is still right.
 *
 * Both read the same `/products/costing/variance`, which must cost every product
 * in one pass regardless: a packed product's cost depends on the semi-finished
 * one it is packed from, so neither screen can be given a pre-filtered set.
 */

export const money = (v: number) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** A signed figure, so a rise and a fall read differently at a glance. */
export const signed = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`;

export const num = (s: string) => Number(s) || 0;
export const round1 = (v: number) => Math.round(v * 10) / 10;

/** Normalise an editable price to 2 decimals (blank / non-numeric passes through). */
export const toPrice = (s: string) => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? round1(n).toFixed(2) : s;
};

/**
 * The cost a margin is judged against: the recomputed figure, unless there is no
 * BOM to compute from, in which case the hand-entered stored cost is all there is.
 */
export const costBasisOf = (r: ProductCostVariance) =>
  r.emptyBom ? r.storedCost : r.computedCost;

export const profitPctAt = (price: number, cost: number) =>
  cost ? round1(((price - cost) / cost) * 100) : 0;

/**
 * How long ago the stored cost was established, in the coarsest useful unit.
 * A cached figure is judged by its AGE rather than its timestamp — "3 months
 * ago" says what needs saying, where a date would have to be worked out.
 */
export const costedAgo = (iso: string | null | undefined): string => {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'never';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
};

/**
 * How a margin sits against the target it was meant to earn.
 *
 *  none  — no target set, so there is nothing to be above or below
 *  ok    — within the product's tolerance; the margin is where it was meant to be
 *  short — BELOW target beyond tolerance: the margin has eroded. Costs money
 *  over  — ABOVE target beyond tolerance: not a loss, but worth knowing — the
 *          price may be uncompetitive, or the target has gone stale
 *
 * A blank tolerance means ZERO tolerance, not "never flag": having set a target
 * you want to know when you are off it, and the tolerance only widens the band.
 * What goes unflagged is a channel with no TARGET, since there is then nothing
 * to be off. Mirrors CostingService.priceVariances exactly — the server decides
 * `alert`, and this must agree or a row would be coloured one way and grouped
 * another.
 */
export type VarianceTone = 'none' | 'ok' | 'short' | 'over';

/** Float noise, not a grace margin — the percentages are held to 1 decimal. */
const VARIANCE_EPSILON = 0.05;

export const varianceTone = (
  variancePct: number | null,
  maxVariancePct: number | null,
): VarianceTone => {
  if (variancePct == null) return 'none';
  if (Math.abs(variancePct) - (maxVariancePct ?? 0) <= VARIANCE_EPSILON)
    return 'ok';
  return variancePct < 0 ? 'short' : 'over';
};

/** Text colour per tone. Short is the alarming one, so it gets the alarm colour. */
export const TONE_TEXT: Record<VarianceTone, string> = {
  none: 'text-slate-400',
  ok: 'text-emerald-600 dark:text-emerald-400',
  short: 'text-rose-600 dark:text-rose-400',
  over: 'text-amber-600 dark:text-amber-400',
};

/** A ▲ / ▼ beside the figure, so the direction survives a colour-blind reader. */
export const TONE_MARK: Record<VarianceTone, string> = {
  none: '',
  ok: '',
  short: '▼',
  over: '▲',
};

/**
 * A cost nobody has re-established in a long while is worth a second look even
 * when the recompute agrees with it — the BOM itself may simply be out of date.
 */
export const COST_STALE_DAYS = 90;
export const isCostStale = (iso: string | null | undefined): boolean => {
  if (!iso) return true;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return true;
  return Date.now() - then > COST_STALE_DAYS * 86_400_000;
};
