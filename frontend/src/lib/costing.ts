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
